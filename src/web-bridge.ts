/**
 * WebBridge — connects a local GSD instance to a central manager over WebSocket.
 *
 * Protocol (all messages are JSON):
 *   Bridge → Manager: instance.hello, instance.reset, instance.patch,
 *                      instance.heartbeat, instance.commandResult
 *   Manager → Bridge: manager.prompt, manager.action, manager.questionResponse,
 *                      manager.ping
 *
 * Reconnection strategy: exponential back-off starting at 1 s, capped at 30 s.
 * On every reconnect the bridge sends a full instance.reset so the manager
 * never needs to reconstruct missed patches.
 *
 * One bridge instance = one local GSD session. No multiplexing.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'

import { WebSocket } from 'ws'
import { computeSectionDelta } from '@gsd/web-protocol'
import type {
  BridgeHello,
  BridgeReset,
  BridgePatch,
  BridgeHeartbeat,
  BridgeCommandResult,
  ManagerToBridgeMessage,
  WebUiState,
} from '@gsd/web-protocol'

import { InstanceRuntime } from './web-runtime/instance-runtime.js'
import { type WebAttachFlags, parseWebAttachArgList, parseWebAttachArgs } from './web-attach-args.js'

// ─── Configuration ────────────────────────────────────────────────────────────

export interface WebBridgeOptions {
  /** Absolute path to the project working directory. */
  basePath: string
  /** Path to the GSD CLI entry point (spawns the local RPC subprocess). */
  cliPath: string
  /**
   * Full WebSocket URL of the manager's instance endpoint.
   * Example: "ws://localhost:4040/ws/instance"
   */
  managerUrl: string
  /**
   * Human-readable label for this host, shown in the manager overview.
   * Defaults to os.hostname().
   */
  hostLabel?: string
  /**
   * Stable identifier for this instance. Defaults to a generated string
   * based on hostname + pid + start timestamp.
   */
  instanceId?: string
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000
const MIN_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

export class WebBridge {
  readonly instanceId: string

  private readonly runtime: InstanceRuntime
  private readonly hostLabel: string
  private readonly managerUrl: string
  private readonly version: string

  private ws: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectDelay = MIN_RECONNECT_DELAY_MS
  private stopped = false
  // Previous state snapshot for computing incremental patches.
  private prevState: WebUiState | undefined
  private seq = 0
  private unsubscribeRuntime: (() => void) | null = null

  constructor(options: WebBridgeOptions) {
    this.runtime = new InstanceRuntime({
      basePath: options.basePath,
      cliPath: options.cliPath,
    })
    this.instanceId = options.instanceId ?? generateInstanceId()
    this.hostLabel = options.hostLabel ?? hostname()
    this.managerUrl = options.managerUrl
    this.version = readGsdVersion()
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    process.stderr.write(`[bridge] Starting local runtime for ${this.runtime.projectName}…\n`)
    await this.runtime.start()

    // Subscribe before connecting so we never miss a state change between
    // start() and the first WebSocket open event.
    this.unsubscribeRuntime = this.runtime.onStateChange((state) => {
      this.onRuntimeStateChange(state)
    })

    this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.unsubscribeRuntime) {
      this.unsubscribeRuntime()
      this.unsubscribeRuntime = null
    }
    if (this.ws) {
      this.ws.close(1000, 'bridge stopped')
      this.ws = null
    }

    await this.runtime.stop()
  }

  // ─── WebSocket lifecycle ──────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return

    process.stderr.write(`[bridge] Connecting to manager at ${this.managerUrl}…\n`)
    const ws = new WebSocket(this.managerUrl)
    this.ws = ws

    ws.on('open', () => {
      process.stderr.write(`[bridge] Connected to manager.\n`)
      this.reconnectDelay = MIN_RECONNECT_DELAY_MS

      // Send hello first so the manager can register this instance before
      // receiving the potentially large reset payload.
      this.send(this.buildHello())

      // Always send a full reset after every (re)connect. This ensures the
      // manager has the current ground truth even after a reconnect where
      // patches were missed. The bridge never tries to guess manager state.
      this.sendReset()

      this.startHeartbeat()
    })

    ws.on('message', (data: Buffer) => {
      this.handleManagerMessage(data.toString('utf-8'))
    })

    ws.on('error', (error: Error) => {
      process.stderr.write(`[bridge] WebSocket error: ${error.message}\n`)
    })

    ws.on('close', (code: number, reason: Buffer) => {
      this.ws = null
      this.stopHeartbeat()

      if (this.stopped) return

      const reasonStr = reason.length > 0 ? ` (${reason.toString('utf-8')})` : ''
      process.stderr.write(
        `[bridge] Disconnected (code ${code}${reasonStr}). Reconnecting in ${this.reconnectDelay}ms…\n`,
      )
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      // Clear prev state so the next connect sends a full reset, not a patch.
      this.prevState = undefined
      this.seq = 0
      this.connect()
    }, this.reconnectDelay)

    // Exponential back-off with a hard ceiling.
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const msg: BridgeHeartbeat = { type: 'instance.heartbeat', at: Date.now() }
      this.send(msg)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ─── State streaming ─────────────────────────────────────────────────────

  private onRuntimeStateChange(state: WebUiState): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Keep prevState in sync even when disconnected so the next reconnect
      // can send a fresh reset from the correct snapshot.
      this.prevState = state
      return
    }

    if (!this.prevState) {
      // Safety net: if prevState is unset (e.g. first change before reset),
      // send a full reset rather than an incomplete patch.
      this.sendReset()
      return
    }

    const delta = computeSectionDelta(this.prevState, state, this.seq + 1)
    this.prevState = state
    this.seq = delta.seq

    if (delta.kind === 'patch' && Object.keys(delta.sections ?? {}).length === 0) {
      // No changed sections — skip the wire send to avoid spurious traffic.
      return
    }

    const patch: BridgePatch = {
      type: 'instance.patch',
      seq: delta.seq,
      sections: delta.sections ?? {},
    }
    this.send(patch)
  }

  private sendReset(): void {
    const state = this.runtime.currentState
    if (!state) return

    this.seq += 1
    this.prevState = state

    const reset: BridgeReset = {
      type: 'instance.reset',
      seq: this.seq,
      state,
    }
    this.send(reset)
  }

  // ─── Manager command routing ──────────────────────────────────────────────

  private handleManagerMessage(raw: string): void {
    let msg: ManagerToBridgeMessage
    try {
      msg = JSON.parse(raw) as ManagerToBridgeMessage
    } catch {
      process.stderr.write('[bridge] Received non-JSON message from manager; ignoring.\n')
      return
    }

    // Respond to pings immediately — no async round-trip needed.
    if (msg.type === 'manager.ping') {
      const heartbeat: BridgeHeartbeat = { type: 'instance.heartbeat', at: Date.now() }
      this.send(heartbeat)
      return
    }

    void this.routeManagerCommand(msg)
  }

  private async routeManagerCommand(msg: ManagerToBridgeMessage): Promise<void> {
    if (msg.type === 'manager.prompt') {
      const result = await this.runtime.sendPrompt(msg.message, msg.promptMode)
      this.sendCommandResult(msg.requestId, result.ok, result.error)
      return
    }

    if (msg.type === 'manager.action') {
      const result = await this.runtime.sendAction(msg.action)
      this.sendCommandResult(msg.requestId, result.ok, result.error)
      return
    }

    if (msg.type === 'manager.questionResponse') {
      const result = await this.runtime.sendQuestionResponse(msg.body)
      this.sendCommandResult(msg.requestId, result.ok, result.error)
      return
    }

    // Unknown message type — log and skip rather than crashing the bridge.
    process.stderr.write(
      `[bridge] Unknown manager message type: ${(msg as unknown as { type?: string }).type ?? '?'}\n`,
    )
  }

  private sendCommandResult(requestId: string, ok: boolean, error?: string): void {
    const msg: BridgeCommandResult = {
      type: 'instance.commandResult',
      requestId,
      ok,
      ...(error ? { error } : {}),
    }
    this.send(msg)
  }

  // ─── Wire helpers ─────────────────────────────────────────────────────────

  private buildHello(): BridgeHello {
    return {
      type: 'instance.hello',
      instanceId: this.instanceId,
      projectName: this.runtime.projectName,
      cwd: this.runtime.basePath,
      hostLabel: this.hostLabel,
      version: this.version,
    }
  }

  private send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Start the bridge and block until SIGINT/SIGTERM.
 * Surfaces a clear error to stderr and exits if the manager URL is invalid.
 */
export async function runWebBridge(options: WebBridgeOptions): Promise<void> {
  if (!options.managerUrl || !/^wss?:\/\//.test(options.managerUrl)) {
    process.stderr.write(
      `[bridge] Error: --manager URL must start with ws:// or wss://\n` +
      `[bridge]         Got: ${options.managerUrl || '(empty)'}\n`,
    )
    process.exit(1)
  }

  const bridge = new WebBridge(options)
  await bridge.start()

  process.stderr.write(
    `[bridge] Instance ${bridge.instanceId} attached.\n` +
    `[bridge] Manager: ${options.managerUrl}\n` +
    `[bridge] Press Ctrl-C to detach.\n`,
  )

  await new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      bridge.stop().then(resolve).catch(reject)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}

export { parseWebAttachArgList, parseWebAttachArgs, type WebAttachFlags }

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateInstanceId(): string {
  const host = hostname().replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 20)
  return `${host}-${process.pid}-${Date.now().toString(36)}`
}

function readGsdVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
