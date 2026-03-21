/**
 * Shared browser-facing state for one managed GSD instance.
 * The shapes stay plain and JSON-serializable so the bridge, manager, and
 * browser can exchange them without per-layer translation glue.
 */
export type PromptMode = 'prompt' | 'steer'

export interface ManagedWorkerSummary {
  milestoneId: string
  pid: number
  state: string
  cost: number
  lastHeartbeat: number
}

export interface WebMessageSummary {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  pending?: boolean
}

export interface WebCommandAction {
  id: string
  label: string
  command?: string
  mode?: PromptMode | 'abort'
  style?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

/** A single selectable option in a pending question. */
export interface WebQuestionOption {
  label: string
  description?: string
}

export interface WebAvailableModel {
  label: string
  value: string
  contextWindow: number
  reasoning: boolean
}

export interface WebPendingQuestion {
  id: string
  method: 'select' | 'confirm' | 'input' | 'editor'
  title: string
  message: string | null
  /** Options for select-method questions. Each entry has a label and an optional description. */
  options: WebQuestionOption[]
  allowMultiple: boolean
  placeholder: string | null
  prefill: string | null
  timeoutMs: number | null
  expiresAt: number | null
}

export interface WebInterviewQuestion {
  id: string
  header: string
  question: string
  options: WebQuestionOption[]
  allowMultiple: boolean
}

export interface WebPendingInterview {
  id: string
  title: string
  progress: string | null
  reviewHeadline: string | null
  exitHeadline: string | null
  exitLabel: string | null
  questions: WebInterviewQuestion[]
}

export interface WebLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warning' | 'error' | 'success'
  scope: 'agent' | 'tool' | 'ui' | 'status' | 'rpc'
  message: string
}

export interface WebEditedFileSummary {
  path: string
  timestamp: number
  addedLines: number
  removedLines: number
}

export interface DashboardNextAction {
  action: 'dispatch' | 'stop' | 'skip'
  unitType?: string
  unitId?: string
  reason?: string
}

export interface WebDashboardSessionState {
  connected: boolean
  model: string | null
  sessionId: string | null
  messageCount: number
  pendingMessageCount: number
  isStreaming: boolean
  totalCost: number
  totalTokens: number
  error: string | null
}

export interface WebDashboardState {
  projectName: string
  phase: string
  autoModeRunning: boolean
  autoModePaused: boolean
  currentUnit: { type: string; id: string; startedAt?: number | string } | null
  next: DashboardNextAction | null
  activeMilestone: { id: string; title: string } | null
  activeSlice: { id: string; title: string } | null
  availableModels: WebAvailableModel[]
  blockers: string[]
  actions: WebCommandAction[]
  session: WebDashboardSessionState
}

export interface WebComposerState {
  connected: boolean
  disabled: boolean
  submitLabel: string
  placeholder: string
  error: string | null
}

export interface WebQuestionsState {
  pending: WebPendingQuestion | null
  interview: WebPendingInterview | null
}

export interface WebStatusSliceState {
  id: string
  title: string
  status: 'complete' | 'active' | 'pending' | 'parked'
  risk: string
  doneTasks: number
  totalTasks: number
  activeTasks: string[]
}

export interface WebStatusMilestoneState {
  id: string
  title: string
  status: 'complete' | 'active' | 'pending' | 'parked'
  dependsOn: string[]
  slices: WebStatusSliceState[]
}

export interface WebTimelineEntry {
  id: string
  type: string
  model: string
  startedAt: number
  finishedAt: number
  cost: number
  requestCount: number
  tokens: number
}

export interface WebMetricEntry {
  label: string
  cost: number
  requestCount: number
  tokens: number
  units: number
}

export interface WebStatusState {
  error: string | null
  summary: {
    phase: string
    doneMilestones: number
    totalMilestones: number
    doneSlices: number
    totalSlices: number
    remainingSlices: number
    progressPercent: number
    cost: number
    tokens: number
    completionRate: number
    nextAction: string
  }
  blockers: string[]
  milestones: WebStatusMilestoneState[]
  timeline: WebTimelineEntry[]
  phaseMetrics: WebMetricEntry[]
  sliceMetrics: WebMetricEntry[]
  milestoneMetrics: WebMetricEntry[]
  modelMetrics: WebMetricEntry[]
  workers: ManagedWorkerSummary[]
}

export interface WebUiState {
  dashboard: WebDashboardState
  recentMessages: WebMessageSummary[]
  recentFiles: WebEditedFileSummary[]
  composer: WebComposerState
  questions: WebQuestionsState
  logs: WebLogEntry[]
  status: WebStatusState
}

/**
 * Keeping the canonical section order shared avoids every layer inventing its
 * own idea of what "all sections" means for subscriptions and filtering.
 */
export const WEB_UI_SECTION_NAMES = [
  'dashboard',
  'recentMessages',
  'recentFiles',
  'composer',
  'questions',
  'logs',
  'status',
] as const satisfies ReadonlyArray<keyof WebUiState>

export type WebUiSection = typeof WEB_UI_SECTION_NAMES[number]

/**
 * Manager overview is intentionally compact. It gives operators enough
 * information to choose an instance without paying the cost of full detail
 * subscriptions for every live session.
 */
export interface ManagedInstanceSummary {
  instanceId: string
  projectKey: string
  displayName: string
  projectName: string
  cwd: string
  hostLabel: string
  connected: boolean
  stale: boolean
  phase: string
  activeMilestone: { id: string; title: string } | null
  activeSlice: { id: string; title: string } | null
  nextAction: string
  autoModeRunning: boolean
  autoModePaused: boolean
  isStreaming: boolean
  hasPendingQuestion: boolean
  model: string | null
  sessionId: string | null
  sessionName: string | null
  totalCost: number
  totalTokens: number
  lastSeenAt: number
  error: string | null
}

export interface OverviewCounts {
  total: number
  connected: number
  streaming: number
  stale: number
  blocked: number
}

export interface OverviewState {
  instances: ManagedInstanceSummary[]
  counts: OverviewCounts
  updatedAt: number
}

export const OVERVIEW_SECTION_NAMES = [
  'instances',
  'counts',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof OverviewState>

export type OverviewSection = typeof OVERVIEW_SECTION_NAMES[number]
