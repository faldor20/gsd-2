/**
 * Overview store — derives OverviewState from the live instance registry
 * snapshot and maintains a history buffer for browser replay.
 *
 * The manager never receives a separate "overview" stream from bridges.
 * Instead, every time an instance's detail state changes, the caller invokes
 * update() with the full registry snapshot.  computeSectionDelta computes the
 * minimal wire delta so browsers that are up-to-date receive only a patch.
 */

import type {
  OverviewReset,
  OverviewPatch,
  OverviewState,
  ManagedInstanceSummary,
  OverviewCounts,
} from "@gsd/web-protocol";
import { computeSectionDelta } from "@gsd/web-protocol";
import { HistoryBuffer } from "./history-buffer.js";
import type { InstanceEntry } from "./instance-registry.js";

export class OverviewStore {
  private state: OverviewState | null = null;
  /** Next seq to assign to the next emitted overview message. */
  private nextSeq = 1;
  /** History buffer for overview messages; used for browser replay. */
  readonly history = new HistoryBuffer<OverviewReset | OverviewPatch>();

  /**
   * Recompute overview state from the provided instance entries, emit the
   * minimal delta (reset or patch), store it in history, and return it.
   *
   * The returned message should be fanned out to all subscribed browsers.
   */
  update(entries: InstanceEntry[]): OverviewReset | OverviewPatch {
    const next = deriveOverviewState(entries);
    const seq = this.nextSeq;
    const delta = computeSectionDelta<OverviewState>(
      this.state ?? undefined,
      next,
      seq,
    );
    this.nextSeq++;
    this.state = next;

    if (delta.kind === "reset") {
      const msg: OverviewReset = {
        type: "overview.reset",
        seq: delta.seq,
        state: delta.state!,
      };
      this.history.push(msg);
      return msg;
    }

    const msg: OverviewPatch = {
      type: "overview.patch",
      seq: delta.seq,
      sections: delta.sections ?? {},
    };
    this.history.push(msg);
    return msg;
  }

  getCurrentState(): OverviewState | null {
    return this.state;
  }

  /** Seq of the last emitted overview message (0 if nothing emitted yet). */
  getCurrentSeq(): number {
    return this.nextSeq - 1;
  }

  /**
   * Build an overview.reset suitable for delivering to a newly-subscribed
   * browser when replay is not available.  Returns null if no overview has
   * been emitted yet.
   */
  buildReset(): OverviewReset | null {
    if (!this.state) return null;
    return {
      type: "overview.reset",
      seq: this.getCurrentSeq(),
      state: this.state,
    };
  }
}

// ── derivation helpers ──────────────────────────────────────────────────────

function deriveOverviewState(entries: InstanceEntry[]): OverviewState {
  const instances = entries.map(deriveSummary);
  return {
    instances,
    counts: deriveCounts(instances),
    updatedAt: Date.now(),
  };
}

/**
 * Project an InstanceEntry into the compact ManagedInstanceSummary shape.
 * All fields are derived from cached state so this is synchronous and cheap.
 */
function deriveSummary(entry: InstanceEntry): ManagedInstanceSummary {
  const state = entry.latestState;
  const dash = state?.dashboard ?? null;
  const session = dash?.session ?? null;
  return {
    instanceId: entry.instanceId,
    projectKey: `${entry.meta.hostLabel}:${entry.meta.cwd}`,
    displayName: entry.meta.projectName,
    projectName: entry.meta.projectName,
    cwd: entry.meta.cwd,
    hostLabel: entry.meta.hostLabel,
    connected: entry.conn !== null,
    stale: entry.stale,
    phase: dash?.phase ?? "",
    activeMilestone: dash?.activeMilestone ?? null,
    activeSlice: dash?.activeSlice ?? null,
    nextAction: dash?.next?.action ?? "",
    autoModeRunning: dash?.autoModeRunning ?? false,
    autoModePaused: dash?.autoModePaused ?? false,
    isStreaming: session?.isStreaming ?? false,
    hasPendingQuestion: (state?.questions?.pending ?? null) !== null,
    model: session?.model ?? null,
    sessionId: session?.sessionId ?? null,
    // sessionName is not carried in WebUiState; set null until protocol evolves
    sessionName: null,
    totalCost: session?.totalCost ?? 0,
    totalTokens: session?.totalTokens ?? 0,
    lastSeenAt: entry.lastSeenAt,
    error: session?.error ?? null,
  };
}

function deriveCounts(instances: ManagedInstanceSummary[]): OverviewCounts {
  return {
    total: instances.length,
    connected: instances.filter((i) => i.connected).length,
    streaming: instances.filter((i) => i.isStreaming).length,
    stale: instances.filter((i) => i.stale).length,
    blocked: instances.filter((i) => i.hasPendingQuestion).length,
  };
}
