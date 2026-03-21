/**
 * InstanceRuntime — reusable local GSD instance state machine.
 *
 * Owns one local RpcClient, derives WebUiState on each poll cycle, and emits
 * change notifications so consumers (HTTP server, WebSocket bridge, etc.) can
 * subscribe without owning the RPC plumbing themselves.
 *
 * Design invariant: one InstanceRuntime = one local GSD session. This class
 * never multiplexes or proxies to remote instances.
 */

import { basename } from 'node:path'

import { RpcClient, type ModelInfo } from '@gsd/pi-coding-agent'
import type { AgentEvent, AgentMessage } from '@gsd/pi-agent-core'
import type { WebAvailableModel, WebUiState } from '@gsd/web-protocol'

import type { QuerySnapshot } from '../headless-query.js'
import { createQuerySnapshot } from '../headless-query.js'
import type { VisualizerData } from '../resources/extensions/gsd/visualizer-data.js'
import type { UnitMetrics } from '../resources/extensions/gsd/metrics.js'
import { importGsdResourceModule } from '../gsd-resource-runtime.js'
import { createMonitorEntry, formatProgress, type ExtensionUIRequest, type MonitorEntry } from '../headless-ui.js'
import {
  buildExtensionUiResponse,
  buildInterviewUiResponse,
  buildPendingInterview,
  buildPendingQuestion,
  buildRecentEditedFiles,
  buildRecentMessages,
  buildUiState,
  createEmptyRuntimeUiState,
  createLogEntry,
  formatError,
  parsePromptMode,
  recordRecentFileEdit,
  summarizeFileEdit,
  type LockData,
  type RpcSnapshot,
  type RuntimeUiState,
} from './ui-state.js'

type RpcExtensionUIResponse =
  | { type: 'extension_ui_response'; id: string; value: string; note?: string }
  | { type: 'extension_ui_response'; id: string; values: string[]; note?: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean; note?: string }
  | { type: 'extension_ui_response'; id: string; cancelled: true; note?: string }

type RpcPromptOptions = { streamingBehavior?: 'steer' | 'followUp' }

// ─── Public contract ─────────────────────────────────────────────────────────

export interface InstanceRuntimeOptions {
  /** Absolute path to the project working directory. */
  basePath: string
  /** Path to the GSD CLI entry point (used to spawn the RPC subprocess). */
  cliPath: string
}

/**
 * Result of a runtime command (prompt / action / question response).
 * Always returns ok/error so callers can forward the result over the wire.
 */
export interface RuntimeCommandResult {
  ok: boolean
  error?: string
}

type StateChangeListener = (state: WebUiState) => void

// Re-export the prompt-mode parser so the bridge can stay decoupled from the
// internal details of the runtime state helper module.
export { parsePromptMode }

// ─── Runtime ─────────────────────────────────────────────────────────────────

const MAX_RUNTIME_LOG_ENTRIES = 200

export class InstanceRuntime {
  readonly basePath: string
  readonly projectName: string

  private readonly runtimeUi: RuntimeUiState = createEmptyRuntimeUiState()
  private rpcClient: RpcClient | null = null
  private rpcError: string | null = null
  private nextRpcRetryAt = 0
  private refreshInFlight = false
  private pollTimer: NodeJS.Timeout | null = null
  private readonly stateListeners: StateChangeListener[] = []
  private availableModels: WebAvailableModel[] = []

  // Exposed as readonly properties rather than method-per-field to let the
  // bridge keep its own seq/history without coupling them to this class.
  private _currentState: WebUiState | undefined
  private _seq = 0

  constructor(private readonly options: InstanceRuntimeOptions) {
    this.basePath = options.basePath
    this.projectName = basename(options.basePath)
  }

  get currentState(): WebUiState | undefined {
    return this._currentState
  }

  get seq(): number {
    return this._seq
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Initial state before the poll timer fires.
    await this.refreshState()

    this.pollTimer = setInterval(() => {
      void this.refreshState()
    }, 2000)
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.rpcClient) {
      await this.rpcClient.stop()
      this.rpcClient = null
    }

    this.availableModels = []
  }

  /**
   * Force an immediate state refresh outside of the poll cycle.
   * Safe to call concurrently — a refresh already in flight is skipped.
   */
  async forcePoll(): Promise<void> {
    if (this.refreshInFlight) return
    await this.refreshState()
  }

  // ─── Change notifications ───────────────────────────────────────────────

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * The listener receives the NEXT full WebUiState after each successful
   * refresh that produced at least one changed section.
   */
  onStateChange(listener: StateChangeListener): () => void {
    this.stateListeners.push(listener)
    return () => {
      const index = this.stateListeners.indexOf(listener)
      if (index !== -1) this.stateListeners.splice(index, 1)
    }
  }

  // ─── Command routing ────────────────────────────────────────────────────

  /**
   * Send a user prompt to the local RPC session.
   * Routes through steer/followUp/prompt depending on streaming state.
   */
  async sendPrompt(message: string, mode: string): Promise<RuntimeCommandResult> {
    const client = await this.ensureRpcClient(true)
    if (!client) {
      return { ok: false, error: this.rpcError ?? 'RPC is unavailable.' }
    }

    try {
      const parsedMode = parsePromptMode(mode)
      const state = await client.getState()
      if (parsedMode === 'steer') {
        await client.steer(message)
      } else if (state.isStreaming) {
        await client.followUp(message)
      } else {
        await client.prompt(message)
      }
      await this.forcePoll()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  }

  /**
   * Run a named action command (auto / next / pause / stop / abort).
   * These map to /gsd slash-commands sent through the local RPC session.
   */
  async sendAction(action: string): Promise<RuntimeCommandResult> {
    const client = await this.ensureRpcClient(true)
    if (!client) {
      return { ok: false, error: this.rpcError ?? 'RPC is unavailable.' }
    }

    try {
      if (action === 'abort') {
        await client.abort()
        return { ok: true }
      }

      const allowedCommands: Record<string, string> = {
        auto: '/gsd auto',
        next: '/gsd next',
        pause: '/gsd pause',
        stop: '/gsd stop',
      }
      const command = allowedCommands[action]
      if (!command) {
        return { ok: false, error: `Unknown command action: ${action}` }
      }

      const state = await client.getState()
      // The current RPC client only exposes prompt(message, images). Web mode
      // still needs queue semantics while streaming, so we speak the narrower
      // runtime-compatible shape that rpc-mode already accepts.
      const opts: RpcPromptOptions | undefined = state.isStreaming
        ? { streamingBehavior: 'steer' }
        : undefined
      await (client as unknown as { prompt(message: string, images?: unknown, options?: RpcPromptOptions): Promise<void> })
        .prompt(command, undefined, opts)
      await this.forcePoll()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  }

  /**
   * Respond to a pending interactive question forwarded from the manager.
   * The `body` shape matches the browser/manager question-response payload.
   */
  async sendQuestionResponse(body: Record<string, unknown>): Promise<RuntimeCommandResult> {
    const pendingInterview = this.runtimeUi.pendingInterview
    const pending = this.runtimeUi.pendingQuestion
    if (!pendingInterview && !pending) {
      return { ok: false, error: 'No pending question.' }
    }

    const activeRequestId = pendingInterview?.id ?? pending?.id
    const responseId = typeof body.id === 'string' ? body.id : activeRequestId
    if (!activeRequestId || responseId !== activeRequestId) {
      return { ok: false, error: 'Question ID does not match current pending request.' }
    }

    const client = await this.ensureRpcClient(true)
    if (!client) {
      return { ok: false, error: this.rpcError ?? 'RPC is unavailable.' }
    }

    try {
      const response = pendingInterview
        ? buildInterviewUiResponse(pendingInterview, body)
        : buildExtensionUiResponse(pending!, body)

      // Extension UI replies are fire-and-forget stdin messages in rpc-mode,
      // so they must use the dedicated helper instead of the request/response
      // command channel used by normal RpcCommand messages.
      await client.respondToUiRequest(response)
      this.runtimeUi.pendingQuestion = null
      this.runtimeUi.pendingInterview = null
      await this.forcePoll()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  }

  // ─── RPC client management ───────────────────────────────────────────────

  /**
   * Returns the live RPC client, creating one if none exists.
   * On transient failures, applies a 5-second back-off before retrying.
   * Pass `force = true` to skip the back-off (for user-triggered commands).
   */
  private async ensureRpcClient(force = false): Promise<RpcClient | null> {
    if (this.rpcClient) return this.rpcClient
    if (!force && Date.now() < this.nextRpcRetryAt) return null

    const client = new RpcClient({
      cliPath: this.options.cliPath,
      cwd: this.options.basePath,
    })

    try {
      await client.start()
      client.onEvent((event) => {
        void this.handleRpcEvent(event)
      })
      this.rpcClient = client
      this.rpcError = null
      this.appendLog({
        timestamp: Date.now(),
        level: 'success',
        scope: 'rpc',
        message: 'RPC session connected',
      })
      return client
    } catch (error) {
      this.rpcError = `RPC unavailable: ${formatError(error)}`
      this.nextRpcRetryAt = Date.now() + 5000
      this.appendLog({
        timestamp: Date.now(),
        level: 'warning',
        scope: 'rpc',
        message: this.rpcError,
      })
      return null
    }
  }

  private appendLog(entry: MonitorEntry): void {
    this.runtimeUi.logs.push(createLogEntry(entry))
    if (this.runtimeUi.logs.length > MAX_RUNTIME_LOG_ENTRIES) {
      this.runtimeUi.logs.splice(0, this.runtimeUi.logs.length - MAX_RUNTIME_LOG_ENTRIES)
    }

    const line = formatProgress({ type: 'extension_ui_request', method: 'notify', message: entry.message, notifyType: entry.level }, true)
    if (line) {
      process.stderr.write(`${line}\n`)
    }
  }

  private async handleRpcEvent(event: AgentEvent | ExtensionUIRequest): Promise<void> {
    const eventRecord = event as unknown as Record<string, unknown>
    const monitorEntry = createMonitorEntry(eventRecord, true)
    if (monitorEntry) {
      this.appendLog(monitorEntry)
    }

    if (event.type === 'tool_execution_start') {
      this.runtimeUi.toolCalls.set(event.toolCallId, {
        toolName: event.toolName,
        args: isPlainObject(event.args) ? event.args as Record<string, unknown> : null,
        startedAt: Date.now(),
      })
    }

    if (event.type === 'tool_execution_end') {
      const toolCall = this.runtimeUi.toolCalls.get(event.toolCallId)
      this.runtimeUi.toolCalls.delete(event.toolCallId)
      const summary = summarizeFileEdit(
        this.options.basePath,
        toolCall?.toolName ?? event.toolName,
        toolCall?.args,
        event.result,
        Date.now(),
      )
      if (summary && !event.isError) {
        recordRecentFileEdit(this.runtimeUi, summary)
      }
      await this.forcePoll()
      return
    }

    if (eventRecord.type === 'extension_ui_request') {
      const uiEvent = eventRecord as ExtensionUIRequest
      const interview = buildPendingInterview(uiEvent)
      if (interview !== null) {
        this.runtimeUi.pendingInterview = interview
        this.runtimeUi.pendingQuestion = null
        await this.forcePoll()
        return
      }
      const question = buildPendingQuestion(uiEvent)
      if (question !== null) {
        // Only overwrite for real question types; fire-and-forget events
        // (notify, setStatus, setWidget, etc.) must not clear a pending question.
        this.runtimeUi.pendingQuestion = question
        this.runtimeUi.pendingInterview = null
      }
      await this.forcePoll()
      return
    }

    if (
      event.type === 'agent_start'
      || event.type === 'message_start'
      || event.type === 'message_update'
      || event.type === 'message_end'
      || event.type === 'agent_end'
    ) {
      if (event.type === 'agent_end') {
        this.runtimeUi.pendingQuestion = null
        this.runtimeUi.pendingInterview = null
        this.runtimeUi.toolCalls.clear()
      }
      await this.forcePoll()
    }
  }

  private async collectRpcSnapshot(): Promise<RpcSnapshot> {
    const client = await this.ensureRpcClient()
    if (!client) {
      return {
        connected: false,
        state: null,
        stats: null,
        messages: [],
        availableModels: this.availableModels,
        error: this.rpcError,
      }
    }

    try {
      const [state, stats, messages] = await Promise.all([
        client.getState(),
        client.getSessionStats(),
        client.getMessages(),
      ])
      if (this.availableModels.length === 0) {
        try {
          this.availableModels = (await client.getAvailableModels()).map(formatAvailableModel)
        } catch {
          // Keep the dashboard usable even if model discovery is unavailable.
        }
      }
      this.rpcError = null
      return { connected: true, state, stats, messages, availableModels: this.availableModels, error: null }
    } catch (error) {
      this.rpcError = `RPC request failed: ${formatError(error)}`
      this.appendLog({ timestamp: Date.now(), level: 'warning', scope: 'rpc', message: this.rpcError })
      try {
        await client.stop()
      } catch (stopError) {
        this.rpcError = `${this.rpcError} (shutdown failed: ${formatError(stopError)})`
      }
      this.rpcClient = null
      this.nextRpcRetryAt = Date.now() + 5000
      return { connected: false, state: null, stats: null, messages: [], availableModels: this.availableModels, error: this.rpcError }
    }
  }

  // ─── State refresh ───────────────────────────────────────────────────────

  private async refreshState(): Promise<void> {
    if (this.refreshInFlight) return
    this.refreshInFlight = true

    try {
      let query: QuerySnapshot | null = null
      let visualizer: VisualizerData | null = null
      let statusError: string | null = null
      let lock: LockData | null = null

      try {
        const [
          { loadVisualizerData },
          { readCrashLock, isLockProcessAlive },
          nextQuery,
        ] = await Promise.all([
          importGsdResourceModule<{ loadVisualizerData(basePath: string): Promise<VisualizerData> }>('visualizer-data.ts'),
          importGsdResourceModule<{
            readCrashLock(basePath: string): LockData | null
            isLockProcessAlive(lock: LockData): boolean
          }>('crash-recovery.ts'),
          createQuerySnapshot(this.options.basePath),
        ])
        query = nextQuery
        visualizer = await loadVisualizerData(this.options.basePath)
        const activeLock = readCrashLock(this.options.basePath)
        lock = activeLock && isLockProcessAlive(activeLock) ? activeLock : null
      } catch (error) {
        statusError = formatError(error)
      }

      const rpc = await this.collectRpcSnapshot()
      // buildUiState returns the protocol-compatible browser state used by the
      // manager bridge and frontend.
      const nextState = buildUiState(
        this.options.basePath,
        this.projectName,
        query,
        visualizer,
        rpc,
        statusError,
        this.runtimeUi,
        lock,
      ) as unknown as WebUiState

      const prevState = this._currentState
      this._currentState = nextState

      // Only notify if something actually changed.
      if (!prevState || hasStateChanged(prevState, nextState)) {
        this._seq += 1
        for (const listener of this.stateListeners) {
          listener(nextState)
        }
      }
    } finally {
      this.refreshInFlight = false
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatAvailableModel(model: ModelInfo): WebAvailableModel {
  return {
    label: model.name || `${model.provider}/${model.id}`,
    value: `${model.provider}/${model.id}`,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
  }
}

/**
 * Cheap structural-equality check between two WebUiState snapshots.
 * Only used to decide whether to fire change listeners — false positives
 * (firing when nothing changed) are benign; false negatives would stall
 * the bridge. We use JSON serialisation because the full state is small
 * and already JSON-serialisable by design.
 */
function hasStateChanged(prev: WebUiState, next: WebUiState): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next)
}

// Type-only re-export so the bridge can reference these without importing from
// the server module directly.
export type { RuntimeUiState, RpcSnapshot, LockData }
