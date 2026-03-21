import type { SectionPayload } from './section-delta.js'
import type {
  OverviewState,
  PromptMode,
  WebUiSection,
  WebUiState,
} from './web-ui-state.js'

/**
 * These transport envelopes are the contract between all three workstreams.
 * They intentionally avoid framework-specific details so the bridge, manager,
 * and browser can evolve independently while sharing one wire vocabulary.
 */
export type InstanceAction = 'auto' | 'next' | 'pause' | 'stop' | 'abort'

export interface BridgeHello {
  type: 'instance.hello'
  instanceId: string
  projectName: string
  cwd: string
  hostLabel: string
  version: string
}

export type WebUiSectionsPayload = Partial<{
  [K in WebUiSection]: SectionPayload<WebUiState[K]>
}>

export type OverviewSectionsPayload = Partial<{
  [K in keyof OverviewState]: SectionPayload<OverviewState[K]>
}>

export interface BridgeReset {
  type: 'instance.reset'
  seq: number
  state: WebUiState
}

export interface BridgePatch {
  type: 'instance.patch'
  seq: number
  sections: WebUiSectionsPayload
}

export interface BridgeHeartbeat {
  type: 'instance.heartbeat'
  at: number
}

export interface BridgeCommandResult {
  type: 'instance.commandResult'
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}

export type BridgeToManagerMessage =
  | BridgeHello
  | BridgeReset
  | BridgePatch
  | BridgeHeartbeat
  | BridgeCommandResult

export interface ManagerPromptCommand {
  type: 'manager.prompt'
  requestId: string
  message: string
  promptMode: PromptMode
}

export interface ManagerActionCommand {
  type: 'manager.action'
  requestId: string
  action: InstanceAction
}

export interface ManagerQuestionResponseCommand {
  type: 'manager.questionResponse'
  requestId: string
  body: Record<string, unknown>
}

export interface ManagerPing {
  type: 'manager.ping'
  at: number
}

export type ManagerToBridgeMessage =
  | ManagerPromptCommand
  | ManagerActionCommand
  | ManagerQuestionResponseCommand
  | ManagerPing

export interface BrowserSubscribe {
  type: 'browser.subscribe'
  overview: true
  instanceId?: string
  sections?: WebUiSection[]
  overviewSeq?: number
  instanceSeq?: number
}

export interface BrowserSelectInstance {
  type: 'browser.selectInstance'
  instanceId: string | null
  sections?: WebUiSection[]
  instanceSeq?: number
}

export interface BrowserPrompt {
  type: 'browser.prompt'
  instanceId: string
  message: string
  promptMode: PromptMode
}

export interface BrowserAction {
  type: 'browser.action'
  instanceId: string
  action: InstanceAction
}

export interface BrowserQuestionResponse {
  type: 'browser.questionResponse'
  instanceId: string
  body: Record<string, unknown>
}

export type BrowserToManagerMessage =
  | BrowserSubscribe
  | BrowserSelectInstance
  | BrowserPrompt
  | BrowserAction
  | BrowserQuestionResponse

export interface OverviewReset {
  type: 'overview.reset'
  seq: number
  state: OverviewState
}

export interface OverviewPatch {
  type: 'overview.patch'
  seq: number
  sections: OverviewSectionsPayload
}

export interface InstanceReset {
  type: 'instance.reset'
  instanceId: string
  seq: number
  state: Partial<WebUiState>
}

export interface InstancePatch {
  type: 'instance.patch'
  instanceId: string
  seq: number
  sections: WebUiSectionsPayload
}

export interface BrowserCommandResult {
  type: 'command.result'
  requestId: string
  ok: boolean
  error?: string
}

export type ManagerToBrowserMessage =
  | OverviewReset
  | OverviewPatch
  | InstanceReset
  | InstancePatch
  | BrowserCommandResult
