/**
 * Headless UI Handling — auto-response, progress formatting, and supervised stdin
 *
 * Handles extension UI requests (auto-responding in headless mode),
 * formats progress events for stderr output, and reads orchestrator
 * commands from stdin in supervised mode.
 */

import type { Readable } from 'node:stream'

import { RpcClient, attachJsonlLineReader, serializeJsonLine } from '@gsd/pi-coding-agent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtensionUIRequest {
  type: 'extension_ui_request'
  id: string
  method: string
  title?: string
  options?: Array<string | { label: string; description?: string }>
  questions?: Array<{
    id: string
    header: string
    question: string
    options: Array<string | { label: string; description?: string }>
    allowMultiple?: boolean
  }>
  message?: string
  placeholder?: string
  prefill?: string
  timeout?: number
  allowMultiple?: boolean
  notifyType?: 'info' | 'warning' | 'error' | 'success'
  statusText?: string
  progress?: string
  reviewHeadline?: string
  exitHeadline?: string
  exitLabel?: string
  widgetKey?: string
  widgetLines?: string[]
  text?: string
  [key: string]: unknown
}

export type { ExtensionUIRequest }

export interface MonitorEntry {
  timestamp: number
  level: 'info' | 'warning' | 'error' | 'success'
  scope: 'agent' | 'tool' | 'ui' | 'status' | 'rpc'
  message: string
}

function formatUiPromptTitle(event: ExtensionUIRequest): string {
  return event.title || event.message || event.placeholder || 'Request'
}

function readOptionLabel(option: string | { label: string; description?: string } | undefined): string {
  if (typeof option === 'string') return option
  return option?.label ?? ''
}

function buildInterviewAutoAnswers(event: ExtensionUIRequest): Record<string, { selected: string | string[]; notes: string }> {
  const answers: Record<string, { selected: string | string[]; notes: string }> = {}
  for (const question of event.questions ?? []) {
    const firstOption = readOptionLabel(question.options?.[0])
    answers[question.id] = {
      selected: question.allowMultiple ? (firstOption ? [firstOption] : []) : firstOption,
      notes: '',
    }
  }
  return answers
}

export function createMonitorEntry(event: Record<string, unknown>, verbose: boolean): MonitorEntry | null {
  const type = String(event.type ?? '')
  const timestamp = Date.now()

  switch (type) {
    case 'tool_execution_start':
      if (!verbose) return null
      return {
        timestamp,
        level: 'info',
        scope: 'tool',
        message: `Started ${String(event.toolName ?? 'unknown')}`,
      }

    case 'tool_execution_end': {
      if (!verbose) return null
      const toolName = String(event.toolName ?? 'unknown')
      const isError = Boolean(event.isError)
      return {
        timestamp,
        level: isError ? 'error' : 'success',
        scope: 'tool',
        message: `${isError ? 'Failed' : 'Finished'} ${toolName}`,
      }
    }

    case 'agent_start':
      return { timestamp, level: 'info', scope: 'agent', message: 'Session started' }

    case 'agent_end':
      return { timestamp, level: 'info', scope: 'agent', message: 'Session ended' }

    case 'extension_ui_request': {
      const uiEvent = event as ExtensionUIRequest
      if (uiEvent.method === 'notify') {
        return {
          timestamp,
          level: uiEvent.notifyType ?? 'info',
          scope: 'ui',
          message: String(uiEvent.message ?? ''),
        }
      }
      if (uiEvent.method === 'setStatus') {
        return {
          timestamp,
          level: 'info',
          scope: 'status',
          message: String(uiEvent.statusText ?? uiEvent.message ?? ''),
        }
      }
      if (uiEvent.method === 'setWidget') {
        return {
          timestamp,
          level: 'info',
          scope: 'ui',
          message: `Widget updated${uiEvent.widgetKey ? `: ${uiEvent.widgetKey}` : ''}`,
        }
      }
      if (uiEvent.method === 'setTitle') {
        return {
          timestamp,
          level: 'info',
          scope: 'ui',
          message: `Title set: ${String(uiEvent.title ?? '')}`,
        }
      }
      if (uiEvent.method === 'set_editor_text') {
        return {
          timestamp,
          level: 'info',
          scope: 'ui',
          message: 'Editor text updated',
        }
      }
      return {
        timestamp,
        level: 'info',
        scope: 'ui',
        message: `${uiEvent.method} requested: ${formatUiPromptTitle(uiEvent)}`,
      }
    }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Extension UI Auto-Responder
// ---------------------------------------------------------------------------

export function handleExtensionUIRequest(
  event: ExtensionUIRequest,
  writeToStdin: (data: string) => void,
): void {
  const { id, method } = event
  let response: Record<string, unknown>

  switch (method) {
    case 'select':
      response = { type: 'extension_ui_response', id, value: readOptionLabel(event.options?.[0]) }
      break
    case 'interview':
      response = { type: 'extension_ui_response', id, answers: buildInterviewAutoAnswers(event) }
      break
    case 'confirm':
      response = { type: 'extension_ui_response', id, confirmed: true }
      break
    case 'input':
      response = { type: 'extension_ui_response', id, value: '' }
      break
    case 'editor':
      response = { type: 'extension_ui_response', id, value: event.prefill ?? '' }
      break
    case 'notify':
    case 'setStatus':
    case 'setWidget':
    case 'setTitle':
    case 'set_editor_text':
      response = { type: 'extension_ui_response', id, value: '' }
      break
    default:
      process.stderr.write(`[headless] Warning: unknown extension_ui_request method "${method}", cancelling\n`)
      response = { type: 'extension_ui_response', id, cancelled: true }
      break
  }

  writeToStdin(serializeJsonLine(response))
}

// ---------------------------------------------------------------------------
// Progress Formatter
// ---------------------------------------------------------------------------

export function formatProgress(event: Record<string, unknown>, verbose: boolean): string | null {
  const entry = createMonitorEntry(event, verbose)
  if (!entry) return null

  switch (entry.scope) {
    case 'tool':
      return `  [tool]    ${entry.message}`
    case 'agent':
      return `[agent]   ${entry.message}`
    case 'status':
      return `[status]  ${entry.message}`
    case 'rpc':
      return `[rpc]     ${entry.message}`
    case 'ui':
      return `[gsd]     ${entry.message}`
    default:
      return `[headless] ${entry.message}`
  }
}

// ---------------------------------------------------------------------------
// Supervised Stdin Reader
// ---------------------------------------------------------------------------

export function startSupervisedStdinReader(
  stdinWriter: (data: string) => void,
  client: RpcClient,
  onResponse: (id: string) => void,
): () => void {
  return attachJsonlLineReader(process.stdin as Readable, (line) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      process.stderr.write(`[headless] Warning: invalid JSON from orchestrator stdin, skipping\n`)
      return
    }

    const type = String(msg.type ?? '')

    switch (type) {
      case 'extension_ui_response':
        stdinWriter(line + '\n')
        if (typeof msg.id === 'string') {
          onResponse(msg.id)
        }
        break
      case 'prompt':
        client.prompt(String(msg.message ?? ''))
        break
      case 'steer':
        client.steer(String(msg.message ?? ''))
        break
      case 'follow_up':
        client.followUp(String(msg.message ?? ''))
        break
      default:
        process.stderr.write(`[headless] Warning: unknown message type "${type}" from orchestrator stdin\n`)
        break
    }
  })
}
