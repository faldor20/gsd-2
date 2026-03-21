/**
 * Shared web-runtime state helpers.
 *
 * The gsd-web manager bridge and its local runtime both need the same logic
 * for turning RPC events, recent messages, and GSD status snapshots into the
 * plain JSON state consumed by the browser. Keeping that assembly code here
 * lets the bridge reuse it without duplicating presentation logic.
 */

import type { AgentMessage } from '@gsd/pi-agent-core'
import type { RpcSessionState, SessionStats } from '@gsd/pi-coding-agent'
import type {
  WebCommandAction,
  WebComposerState,
  WebAvailableModel as BrowserAvailableModel,
  WebDashboardState,
  WebEditedFileSummary,
  WebInterviewQuestion,
  WebLogEntry,
  WebMessageSummary,
  WebMetricEntry,
  WebPendingInterview,
  WebPendingQuestion,
  WebQuestionOption,
  WebQuestionsState,
  WebStatusState,
  WebUiState,
} from '@gsd/web-protocol'

import type { QuerySnapshot } from '../headless-query.js'
import type { ExtensionUIRequest, MonitorEntry } from '../headless-ui.js'
import type { VisualizerData } from '../resources/extensions/gsd/visualizer-data.js'
import { classifyUnitPhase, type UnitMetrics } from '../resources/extensions/gsd/metrics.js'
import { parseUnitId } from '../resources/extensions/gsd/unit-id.js'

type RpcExtensionUIResponse =
  | { type: 'extension_ui_response'; id: string; value: string; note?: string }
  | { type: 'extension_ui_response'; id: string; values: string[]; note?: string }
  | { type: 'extension_ui_response'; id: string; answers: Record<string, { selected: string | string[]; notes: string }> }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean; note?: string }
  | { type: 'extension_ui_response'; id: string; cancelled: true; note?: string }

type WebQuestionResponseInput = Record<string, unknown>

export type PromptMode = 'prompt' | 'steer'

export interface RpcSnapshot {
  connected: boolean
  state: RpcSessionState | null
  stats: SessionStats | null
  messages: AgentMessage[]
  availableModels: BrowserAvailableModel[]
  error: string | null
}

export interface RuntimeUiState {
  pendingQuestion: WebPendingQuestion | null
  pendingInterview: WebPendingInterview | null
  logs: WebLogEntry[]
  fileEdits: WebEditedFileSummary[]
  toolCalls: Map<string, { toolName: string; args: Record<string, unknown> | null; startedAt: number }>
}

export interface LockData {
  pid: number
  startedAt: string
  unitType: string
  unitId: string
  unitStartedAt: string
  completedUnits: number
  sessionFile?: string
}

const MAX_RECENT_MESSAGES = 10
const MAX_RECENT_FILES = 10
const MAX_LOG_ENTRIES = 20

export function createEmptyRuntimeUiState(): RuntimeUiState {
  return {
    pendingQuestion: null,
    pendingInterview: null,
    logs: [],
    fileEdits: [],
    toolCalls: new Map(),
  }
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function squashWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxLength = 240): string {
  const trimmed = squashWhitespace(value)
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1)}…`
}

function stringifyStructuredValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function countTextLines(value: string): number {
  if (!value) return 0
  return value.split(/\r?\n/).length
}

function countDiffLines(diff: string | undefined): { addedLines: number; removedLines: number } {
  if (!diff) return { addedLines: 0, removedLines: 0 }

  let addedLines = 0
  let removedLines = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) {
      addedLines += 1
    } else if (line.startsWith('-')) {
      removedLines += 1
    }
  }
  return { addedLines, removedLines }
}

function compactPath(basePath: string, path: string): string {
  const nextPath = path.trim()
  if (!nextPath) return nextPath
  const relativePath = nextPath.startsWith(basePath) ? nextPath.slice(basePath.length).replace(/^\//, '') : ''
  if (!relativePath || relativePath.startsWith('..')) {
    return nextPath
  }
  return relativePath
}

function getToolPath(args: Record<string, unknown> | null | undefined): string | null {
  const candidate = args?.path ?? args?.file_path
  return typeof candidate === 'string' && candidate.trim() ? candidate : null
}

export function summarizeFileEdit(
  basePath: string,
  toolName: string,
  args: Record<string, unknown> | null | undefined,
  result: unknown,
  timestamp: number,
): WebEditedFileSummary | null {
  const rawPath = getToolPath(args)
  if (!rawPath) return null

  let addedLines = 0
  let removedLines = 0
  if (toolName === 'edit') {
    const diff = isObject(result)
      && isObject(result.details)
      && typeof result.details.diff === 'string'
      ? result.details.diff
      : undefined
    if (diff) {
      const diffStats = countDiffLines(diff)
      addedLines = diffStats.addedLines
      removedLines = diffStats.removedLines
    } else {
      addedLines = typeof args?.newText === 'string' ? countTextLines(args.newText) : 0
      removedLines = typeof args?.oldText === 'string' ? countTextLines(args.oldText) : 0
    }
  } else if (toolName === 'write') {
    addedLines = typeof args?.content === 'string' ? countTextLines(args.content) : 0
  } else {
    return null
  }

  return {
    path: compactPath(basePath, rawPath),
    timestamp,
    addedLines,
    removedLines,
  }
}

type MessageToolCall = { toolName: string; args: Record<string, unknown> | null; timestamp: number }

function collectToolCallsById(messages: AgentMessage[]): Map<string, MessageToolCall> {
  const toolCalls = new Map<string, MessageToolCall>()
  for (const message of messages) {
    if ((message as { role?: string }).role !== 'assistant') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (
        block
        && typeof block === 'object'
        && 'type' in block
        && (block as { type?: string }).type === 'toolCall'
        && typeof (block as { id?: unknown }).id === 'string'
        && typeof (block as { name?: unknown }).name === 'string'
      ) {
        const args = isObject((block as { arguments?: unknown }).arguments)
          ? (block as { arguments: Record<string, unknown> }).arguments
          : null
        toolCalls.set((block as { id: string }).id, {
          toolName: (block as { name: string }).name,
          args,
          timestamp: typeof (message as { timestamp?: unknown }).timestamp === 'number'
            ? (message as { timestamp: number }).timestamp
            : Date.now(),
        })
      }
    }
  }
  return toolCalls
}

function mergeRecentFileEdits(edits: WebEditedFileSummary[]): WebEditedFileSummary[] {
  const merged = new Map<string, WebEditedFileSummary>()
  for (const edit of edits.sort((a, b) => a.timestamp - b.timestamp)) {
    merged.delete(edit.path)
    merged.set(edit.path, edit)
  }
  return Array.from(merged.values()).slice(-MAX_RECENT_FILES)
}

export function buildRecentEditedFiles(
  basePath: string,
  messages: AgentMessage[],
  runtimeEdits: WebEditedFileSummary[],
): WebEditedFileSummary[] {
  const derived: WebEditedFileSummary[] = [...runtimeEdits]
  const toolCalls = collectToolCallsById(messages)

  for (const message of messages) {
    if ((message as { role?: string }).role !== 'toolResult') continue
    const toolResult = message as {
      role: 'toolResult'
      toolCallId?: string
      toolName?: string
      details?: unknown
      timestamp?: number
    }
    const toolCall = typeof toolResult.toolCallId === 'string' ? toolCalls.get(toolResult.toolCallId) : undefined
    const toolName = toolCall?.toolName ?? toolResult.toolName
    if (toolName !== 'edit' && toolName !== 'write') continue

    const summary = summarizeFileEdit(
      basePath,
      toolName,
      toolCall?.args,
      { details: toolResult.details },
      typeof toolResult.timestamp === 'number' ? toolResult.timestamp : (toolCall?.timestamp ?? Date.now()),
    )
    if (summary) {
      derived.push(summary)
    }
  }

  return mergeRecentFileEdits(derived)
}

/**
 * Recent-message cards need a stable text summary even when the underlying
 * assistant message is still in a reasoning/tool-use phase. The web migration
 * made those richer block types much more common, so only reading `text`
 * blocks caused most live assistant messages to be dropped entirely.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      continue
    }

    const typedBlock = block as { type?: string; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown; input?: unknown; content?: unknown }
    switch (typedBlock.type) {
      case 'text': {
        if (typeof typedBlock.text === 'string' && typedBlock.text.trim()) {
          parts.push(typedBlock.text)
        }
        break
      }

      case 'thinking': {
        if (typeof typedBlock.thinking === 'string' && typedBlock.thinking.trim()) {
          parts.push(typedBlock.thinking)
        }
        break
      }

      case 'toolCall': {
        const toolName = typeof typedBlock.name === 'string' && typedBlock.name.trim()
          ? typedBlock.name
          : 'tool'
        const args = truncateText(stringifyStructuredValue(typedBlock.arguments), 120)
        parts.push(args ? `${toolName}(${args})` : toolName)
        break
      }

      case 'serverToolUse': {
        const toolName = typeof typedBlock.name === 'string' && typedBlock.name.trim()
          ? typedBlock.name
          : 'server tool'
        const input = truncateText(stringifyStructuredValue(typedBlock.input), 120)
        parts.push(input ? `${toolName}(${input})` : toolName)
        break
      }

      case 'webSearchResult': {
        const result = truncateText(stringifyStructuredValue(typedBlock.content), 120)
        parts.push(result || 'web search result')
        break
      }
    }
  }
  return parts.join('\n')
}

function summarizeMessage(message: AgentMessage, index: number): WebMessageSummary | null {
  const role = (message as { role?: string }).role
  if (role !== 'user' && role !== 'assistant') return null

  const timestamp = typeof (message as { timestamp?: unknown }).timestamp === 'number'
    ? (message as { timestamp: number }).timestamp
    : Date.now()

  const text = truncateText(extractTextContent((message as { content?: unknown }).content))
  if (!text) return null

  return {
    id: `${timestamp}-${index}-${role}`,
    role,
    text,
    timestamp,
  }
}

export function buildRecentMessages(messages: AgentMessage[], isStreaming: boolean): WebMessageSummary[] {
  const recent = messages
    .map((message, index) => summarizeMessage(message, index))
    .filter((message): message is WebMessageSummary => Boolean(message))
  if (isStreaming) {
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      if (recent[index]?.role === 'assistant') {
        recent[index] = { ...recent[index], pending: true }
        break
      }
    }
  }

  return recent.slice(-MAX_RECENT_MESSAGES)
}

export function parsePromptMode(value: unknown): PromptMode {
  return value === 'steer' ? 'steer' : 'prompt'
}

function readQuestionNote(body: WebQuestionResponseInput): string | undefined {
  return typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined
}

export function buildExtensionUiResponse(
  pending: WebPendingQuestion,
  body: WebQuestionResponseInput,
): RpcExtensionUIResponse {
  const note = readQuestionNote(body)
  if (body.cancelled === true) {
    return { type: 'extension_ui_response', id: pending.id, cancelled: true, note }
  }
  if (pending.method === 'confirm') {
    return { type: 'extension_ui_response', id: pending.id, confirmed: Boolean(body.confirmed), note }
  }
  if (pending.method === 'select' && pending.allowMultiple) {
    if (!Array.isArray(body.values)) {
      throw new Error('Multi-select responses require a values array.')
    }
    return {
      type: 'extension_ui_response',
      id: pending.id,
      values: body.values.map((value) => String(value)),
      note,
    }
  }
  return {
    type: 'extension_ui_response',
    id: pending.id,
    value: typeof body.value === 'string' ? body.value : '',
    note,
  }
}

function normaliseInterviewAnswer(raw: unknown): { selected: string | string[]; notes: string } {
  if (!isObject(raw)) {
    throw new Error('Interview answers must be objects.')
  }

  const notes = typeof raw.notes === 'string' ? raw.notes : ''
  if (Array.isArray(raw.selected)) {
    return {
      selected: raw.selected.map((value) => String(value)),
      notes,
    }
  }
  if (typeof raw.selected === 'string') {
    return { selected: raw.selected, notes }
  }
  throw new Error('Interview answers require a selected value or values array.')
}

export function buildInterviewUiResponse(
  pending: WebPendingInterview,
  body: WebQuestionResponseInput,
): RpcExtensionUIResponse {
  if (body.cancelled === true) {
    return { type: 'extension_ui_response', id: pending.id, cancelled: true }
  }
  if (!isObject(body.answers)) {
    throw new Error('Interview responses require an answers object.')
  }

  const answers: Record<string, { selected: string | string[]; notes: string }> = {}
  for (const question of pending.questions) {
    answers[question.id] = normaliseInterviewAnswer(body.answers[question.id])
  }

  return {
    type: 'extension_ui_response',
    id: pending.id,
    answers,
  }
}

export function createLogEntry(entry: MonitorEntry): WebLogEntry {
  return {
    id: `${entry.timestamp}-${entry.scope}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp,
    level: entry.level,
    scope: entry.scope,
    message: entry.message,
  }
}

/**
 * Extension UI requests arrive in several wire formats. Normalize them into the
 * single browser-facing question shape so the rest of the web runtime does not
 * need method-specific parsing branches.
 */
function normaliseOption(raw: unknown): WebQuestionOption {
  if (typeof raw === 'string') return { label: raw }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const option = raw as Record<string, unknown>
    const description = typeof option.description === 'string' && option.description ? option.description : undefined
    return {
      label: typeof option.label === 'string' ? option.label : String(option.label ?? ''),
      ...(description ? { description } : {}),
    }
  }
  return { label: String(raw ?? '') }
}

function normaliseInterviewQuestion(raw: unknown): WebInterviewQuestion {
  const question = isObject(raw) ? raw : {}
  return {
    id: typeof question.id === 'string' ? question.id : '',
    header: typeof question.header === 'string' ? question.header : '',
    question: typeof question.question === 'string' ? question.question : '',
    options: Array.isArray(question.options) ? question.options.map(normaliseOption) : [],
    allowMultiple: Boolean(question.allowMultiple),
  }
}

export function buildPendingQuestion(event: ExtensionUIRequest): WebPendingQuestion | null {
  if (event.method !== 'select' && event.method !== 'confirm' && event.method !== 'input' && event.method !== 'editor') {
    return null
  }
  const timeoutMs = typeof event.timeout === 'number' ? event.timeout : null
  return {
    id: event.id,
    method: event.method,
    title: event.title || 'Question',
    message: typeof event.message === 'string' ? event.message : null,
    options: Array.isArray(event.options) ? event.options.map(normaliseOption) : [],
    allowMultiple: Boolean(event.allowMultiple),
    placeholder: typeof event.placeholder === 'string' ? event.placeholder : null,
    prefill: typeof event.prefill === 'string' ? event.prefill : null,
    timeoutMs,
    expiresAt: timeoutMs ? Date.now() + timeoutMs : null,
  }
}

export function buildPendingInterview(event: ExtensionUIRequest): WebPendingInterview | null {
  if (event.method !== 'interview') {
    return null
  }
  return {
    id: event.id,
    title: event.title || 'Questions',
    progress: typeof event.progress === 'string' ? event.progress : null,
    reviewHeadline: typeof event.reviewHeadline === 'string' ? event.reviewHeadline : null,
    exitHeadline: typeof event.exitHeadline === 'string' ? event.exitHeadline : null,
    exitLabel: typeof event.exitLabel === 'string' ? event.exitLabel : null,
    questions: Array.isArray(event.questions) ? event.questions.map(normaliseInterviewQuestion) : [],
  }
}

function buildCommandActions(query: QuerySnapshot | null, rpc: RpcSnapshot, lock: LockData | null): WebCommandAction[] {
  const phase = query?.state.phase ?? 'idle'
  const paused = phase === 'paused'
  const running = Boolean(lock) || Boolean(query?.cost.workers.length)
  const connected = rpc.connected

  return [
    {
      id: 'auto',
      label: paused ? 'Resume Auto' : 'Run Auto',
      command: '/gsd auto',
      style: 'primary',
      disabled: !connected || (running && !paused),
    },
    {
      id: 'next',
      label: 'Run Next',
      command: '/gsd next',
      style: 'secondary',
      disabled: !connected,
    },
    {
      id: 'pause',
      label: 'Pause',
      command: '/gsd pause',
      style: 'secondary',
      disabled: !connected || paused || !running,
    },
    {
      id: 'stop',
      label: 'Stop',
      command: '/gsd stop',
      style: 'danger',
      disabled: !connected,
    },
    {
      id: 'abort',
      label: 'Abort Reply',
      mode: 'abort',
      style: 'danger',
      disabled: !connected || !(rpc.state?.isStreaming ?? false),
    },
  ]
}

function buildQuestionsState(runtime: RuntimeUiState): WebQuestionsState {
  return {
    pending: runtime.pendingQuestion,
    interview: runtime.pendingInterview,
  }
}

function buildLogsState(runtime: RuntimeUiState): WebLogEntry[] {
  return runtime.logs.slice(-MAX_LOG_ENTRIES)
}

export function recordRecentFileEdit(runtime: RuntimeUiState, edit: WebEditedFileSummary): void {
  runtime.fileEdits = mergeRecentFileEdits([...runtime.fileEdits, edit])
}

function describeNextAction(next: QuerySnapshot['next'] | null): string {
  if (!next) return 'Status unavailable'
  if (next.action === 'dispatch') {
    return next.unitType && next.unitId
      ? `${next.unitType} ${next.unitId}`
      : 'Dispatch next unit'
  }
  return next.reason ?? next.action
}

function buildDashboardState(
  projectName: string,
  query: QuerySnapshot | null,
  visualizer: VisualizerData | null,
  rpc: RpcSnapshot,
  lock: LockData | null,
): WebDashboardState {
  const currentUnit = lock
    ? { type: lock.unitType, id: lock.unitId, startedAt: lock.unitStartedAt }
    : (visualizer?.agentActivity?.currentUnit ?? null)

  return {
    projectName,
    phase: query?.state.phase ?? visualizer?.phase ?? 'idle',
    autoModeRunning: Boolean(lock) || Boolean(visualizer?.agentActivity?.active) || (query?.cost.workers.length ?? 0) > 0,
    autoModePaused: (query?.state.phase ?? visualizer?.phase ?? 'idle') === 'paused',
    currentUnit,
    next: query?.next ?? null,
    activeMilestone: query?.state.activeMilestone
      ? { id: query.state.activeMilestone.id, title: query.state.activeMilestone.title }
      : null,
    activeSlice: query?.state.activeSlice
      ? { id: query.state.activeSlice.id, title: query.state.activeSlice.title }
      : null,
    availableModels: rpc.availableModels,
    blockers: query?.state.blockers ?? [],
    actions: buildCommandActions(query, rpc, lock),
    session: {
      connected: rpc.connected,
      model: rpc.state?.model ? `${rpc.state.model.provider}/${rpc.state.model.id}` : null,
      sessionId: rpc.state?.sessionId ?? null,
      messageCount: rpc.state?.messageCount ?? 0,
      pendingMessageCount: rpc.state?.pendingMessageCount ?? 0,
      isStreaming: rpc.state?.isStreaming ?? false,
      totalCost: rpc.stats?.cost ?? 0,
      totalTokens: rpc.stats?.tokens.total ?? 0,
      error: rpc.error,
    },
  }
}

function buildMetricEntry(label: string, units: UnitMetrics[]): WebMetricEntry {
  return {
    label,
    cost: units.reduce((sum, unit) => sum + unit.cost, 0),
    requestCount: units.reduce((sum, unit) => sum + (unit.apiRequests ?? unit.assistantMessages), 0),
    tokens: units.reduce((sum, unit) => sum + unit.tokens.total, 0),
    units: units.length,
  }
}

function aggregateUnits(units: UnitMetrics[], getLabel: (unit: UnitMetrics) => string | null): WebMetricEntry[] {
  const groups = new Map<string, UnitMetrics[]>()
  for (const unit of units) {
    const label = getLabel(unit)
    if (!label) continue
    const existing = groups.get(label)
    if (existing) {
      existing.push(unit)
      continue
    }
    groups.set(label, [unit])
  }

  return Array.from(groups.entries())
    .map(([label, groupedUnits]) => buildMetricEntry(label, groupedUnits))
    .sort((left, right) => {
      if (right.cost !== left.cost) return right.cost - left.cost
      if (right.requestCount !== left.requestCount) return right.requestCount - left.requestCount
      return left.label.localeCompare(right.label)
    })
}

function buildStatusState(
  query: QuerySnapshot | null,
  visualizer: VisualizerData | null,
  statusError: string | null,
): WebStatusState {
  const units = visualizer?.units ?? []
  const phaseMetrics = aggregateUnits(units, (unit) => classifyUnitPhase(unit.type))
  const sliceMetrics = aggregateUnits(units, (unit) => {
    const { milestone, slice } = parseUnitId(unit.id)
    return slice ? `${milestone}/${slice}` : null
  })
  const milestoneMetrics = aggregateUnits(units, (unit) => parseUnitId(unit.id).milestone)

  const milestones = visualizer?.milestones ?? []
  const totalSlices = milestones.reduce((sum, milestone) => sum + milestone.slices.length, 0)
  const doneSlices = milestones.reduce((sum, milestone) => sum + milestone.slices.filter((slice) => slice.done).length, 0)
  const doneMilestones = milestones.filter((milestone) => milestone.status === 'complete').length
  const progressPercent = totalSlices > 0 ? Math.round((doneSlices / totalSlices) * 100) : 0
  const blockerText = [
    ...(query?.state.blockers ?? []),
    ...((visualizer?.sliceVerifications ?? [])
      .filter((entry) => entry.blockerDiscovered)
      .map((entry) => `${entry.milestoneId}/${entry.sliceId}: ${entry.verificationResult}`)),
  ].slice(0, 8)

  return {
    error: statusError,
    summary: {
      phase: query?.state.phase ?? visualizer?.phase ?? 'idle',
      doneMilestones,
      totalMilestones: milestones.length,
      doneSlices,
      totalSlices,
      remainingSlices: visualizer?.remainingSliceCount ?? Math.max(totalSlices - doneSlices, 0),
      progressPercent,
      cost: visualizer?.totals?.cost ?? 0,
      tokens: visualizer?.totals?.tokens.total ?? 0,
      completionRate: visualizer?.agentActivity?.completionRate ?? 0,
      nextAction: describeNextAction(query?.next ?? null),
    },
    blockers: blockerText,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      dependsOn: milestone.dependsOn,
      slices: milestone.slices.map((slice) => ({
        id: slice.id,
        title: slice.title,
        status: slice.active ? 'active' : slice.done ? 'complete' : 'pending',
        risk: slice.risk,
        doneTasks: slice.tasks.filter((task) => task.done).length,
        totalTasks: slice.tasks.length,
        activeTasks: slice.tasks.filter((task) => task.active).map((task) => task.title),
      })),
    })),
    timeline: (visualizer?.units ?? []).slice(-10).reverse().map((unit: UnitMetrics) => ({
      id: unit.id,
      type: unit.type,
      model: unit.model,
      startedAt: unit.startedAt,
      finishedAt: unit.finishedAt,
      cost: unit.cost,
      requestCount: unit.apiRequests ?? unit.assistantMessages,
      tokens: unit.tokens.total,
    })),
    phaseMetrics: phaseMetrics,
    sliceMetrics: sliceMetrics.slice(0, 8),
    milestoneMetrics: milestoneMetrics.slice(0, 8),
    modelMetrics: (visualizer?.byModel ?? []).slice(0, 6).map((entry) => ({
      label: entry.model,
      cost: entry.cost,
      requestCount: units
        .filter((unit) => unit.model === entry.model)
        .reduce((sum, unit) => sum + (unit.apiRequests ?? unit.assistantMessages), 0),
      tokens: entry.tokens.total,
      units: entry.units,
    })),
    workers: query?.cost.workers ?? [],
  }
}

function buildComposerState(rpc: RpcSnapshot): WebComposerState {
  const streaming = rpc.state?.isStreaming ?? false
  return {
    connected: rpc.connected,
    disabled: !rpc.connected,
    submitLabel: streaming ? 'Queue follow-up' : 'Send prompt',
    placeholder: streaming
      ? 'Queue a follow-up while GSD is responding…'
      : 'Ask GSD what to do next…',
    error: rpc.error,
  }
}

export function buildUiState(
  basePath: string,
  projectName: string,
  query: QuerySnapshot | null,
  visualizer: VisualizerData | null,
  rpc: RpcSnapshot,
  statusError: string | null,
  runtime: RuntimeUiState,
  lock: LockData | null,
): WebUiState {
  return {
    dashboard: buildDashboardState(projectName, query, visualizer, rpc, lock),
    recentMessages: buildRecentMessages(rpc.messages, rpc.state?.isStreaming ?? false),
    recentFiles: buildRecentEditedFiles(basePath, rpc.messages, runtime.fileEdits),
    composer: buildComposerState(rpc),
    questions: buildQuestionsState(runtime),
    logs: buildLogsState(runtime),
    status: buildStatusState(query, visualizer, statusError),
  }
}

export function shouldIncludeLogsForTab(tab: string): boolean {
  return tab === 'activity'
}