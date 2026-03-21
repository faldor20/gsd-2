import {
  applySectionDelta,
  type BrowserCommandResult,
  type BrowserToManagerMessage,
  type ManagerToBrowserMessage,
  type OverviewState,
  type WebUiSection,
  type WebUiState,
} from "@gsd/web-protocol";

import type {
  ManagerBootstrapPayload,
  ManagerInstanceSnapshot,
} from "../manager-http-contract";

import { createManagerApi } from "./manager-api";
import { createManagerWebSocketUrl } from "./manager-origin";

/**
 * Keep the empty overview shape shared inside the client so reconnect and
 * bootstrap failures always fall back to a predictable baseline.
 */
function createEmptyOverviewState(): OverviewState {
  return {
    instances: [],
    counts: {
      total: 0,
      connected: 0,
      streaming: 0,
      stale: 0,
      blocked: 0,
    },
    updatedAt: 0,
  };
}

/**
 * ManagerClient owns the browser transport surface.
 *
 * - Eden fetches the current overview/detail snapshot for fast first paint.
 * - WebSocket keeps the diff-first live stream for resets, patches, and commands.
 */
export class ManagerClient {
  private readonly api = createManagerApi();
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;
  private selectedInstanceId: string | null = null;
  private selectedSections: WebUiSection[] | undefined;
  private overviewSeq = 0;
  private instanceSeq = 0;

  public overviewState: OverviewState | null = null;
  public instanceState: Partial<WebUiState> | null = null;

  public onOverviewUpdate: (() => void) | null = null;
  public onInstanceUpdate: (() => void) | null = null;
  public onConnectionChange: ((connected: boolean) => void) | null = null;
  public onCommandResult: ((result: BrowserCommandResult) => void) | null =
    null;
  public onError: ((message: string) => void) | null = null;
  public onBootstrapSelection: ((instanceId: string) => void) | null = null;

  constructor(private readonly url: string = createManagerWebSocketUrl()) {}

  connect(): void {
    this.stopped = false;
    void this.loadBootstrap();
    this.openSocket();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.ws?.close();
    this.ws = null;
    this.onConnectionChange?.(false);
  }

  selectInstance(instanceId: string | null, sections?: WebUiSection[]): void {
    this.selectedInstanceId = instanceId;
    this.selectedSections = sections;
    this.instanceSeq = 0;
    this.instanceState = null;
    this.onInstanceUpdate?.();

    if (instanceId) {
      void this.loadInstanceSnapshot(instanceId, sections);
    }

    this.send({
      type: "browser.selectInstance",
      instanceId,
      sections,
      instanceSeq: 0,
    });
  }

  sendPrompt(
    instanceId: string,
    message: string,
    promptMode: "prompt" | "steer",
  ): void {
    this.send({
      type: "browser.prompt",
      instanceId,
      message,
      promptMode,
    });
  }

  sendAction(
    instanceId: string,
    action: "auto" | "next" | "pause" | "stop" | "abort",
  ): void {
    this.send({
      type: "browser.action",
      instanceId,
      action,
    });
  }

  sendQuestionResponse(
    instanceId: string,
    body: Record<string, unknown>,
  ): void {
    this.send({
      type: "browser.questionResponse",
      instanceId,
      body,
    });
  }

  private async loadBootstrap(): Promise<void> {
    const { data, error } = await this.api.api.bootstrap.get();
    const bootstrap = data as ManagerBootstrapPayload | null;
    if (this.stopped) return;

    if (error || !bootstrap) {
      this.onError?.("Failed to load the initial manager snapshot.");
      return;
    }

    this.overviewSeq = bootstrap.overviewSeq;
    this.overviewState = bootstrap.overview;
    this.onOverviewUpdate?.();

    if (!this.selectedInstanceId && bootstrap.recommendedInstanceId) {
      this.onBootstrapSelection?.(bootstrap.recommendedInstanceId);
    }
  }

  private async loadInstanceSnapshot(
    instanceId: string,
    sections?: WebUiSection[],
  ): Promise<void> {
    const query = sections?.length
      ? { sections: sections.join(",") }
      : undefined;
    const response = query
      ? await this.api.api.instances[instanceId].get({ query })
      : await this.api.api.instances[instanceId].get();

    if (this.stopped || this.selectedInstanceId !== instanceId) return;

    const { data, error } = response;
    const snapshot = data as ManagerInstanceSnapshot | null;
    if (error || !snapshot) {
      this.onError?.(`Failed to load instance snapshot for ${instanceId}.`);
      return;
    }

    this.instanceSeq = snapshot.instanceSeq;
    this.instanceState = snapshot.state;
    this.onInstanceUpdate?.();
  }

  private openSocket(): void {
    if (this.ws || this.stopped) return;

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.onConnectionChange?.(true);
      this.send({
        type: "browser.subscribe",
        overview: true,
        instanceId: this.selectedInstanceId ?? undefined,
        sections: this.selectedSections,
        overviewSeq: this.overviewSeq,
        instanceSeq: this.instanceSeq,
      });
    };

    ws.onclose = () => {
      this.ws = null;
      this.onConnectionChange?.(false);
      if (this.stopped || this.reconnectTimer !== null) return;

      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.openSocket();
      }, 2_000);
    };

    ws.onerror = () => {
      this.onError?.("Manager connection failed.");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ManagerToBrowserMessage;
        this.handleMessage(message);
      } catch {
        this.onError?.("Received an invalid manager message.");
      }
    };
  }

  private send(message: BrowserToManagerMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(message: ManagerToBrowserMessage): void {
    switch (message.type) {
      case "overview.reset": {
        this.overviewSeq = message.seq;
        this.overviewState = message.state;
        this.onOverviewUpdate?.();
        return;
      }

      case "overview.patch": {
        if (!this.overviewState) {
          this.overviewState = createEmptyOverviewState();
        }

        this.overviewSeq = message.seq;
        this.overviewState = applySectionDelta(this.overviewState, {
          seq: message.seq,
          kind: "patch",
          sections: message.sections,
        });
        this.onOverviewUpdate?.();
        return;
      }

      case "instance.reset": {
        if (message.instanceId !== this.selectedInstanceId) return;

        this.instanceSeq = message.seq;
        this.instanceState = message.state;
        this.onInstanceUpdate?.();
        return;
      }

      case "instance.patch": {
        if (
          message.instanceId !== this.selectedInstanceId ||
          !this.instanceState
        )
          return;

        this.instanceSeq = message.seq;
        this.instanceState = applySectionDelta(this.instanceState, {
          seq: message.seq,
          kind: "patch",
          sections: message.sections,
        });
        this.onInstanceUpdate?.();
        return;
      }

      case "command.result": {
        this.onCommandResult?.(message);
        if (!message.ok && message.error) {
          this.onError?.(message.error);
        }
      }
    }
  }
}

export { createEmptyOverviewState };
