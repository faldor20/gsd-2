/**
 * Instance registry — owns the authoritative per-instance state on the manager.
 *
 * Responsibilities:
 * - Track the live bridge WebSocket connection for each instanceId.
 * - Maintain the full cached WebUiState for each instance (updated on every
 *   reset/patch from the bridge so overview derivation is always cheap).
 * - Assign a manager-owned monotonic seq to the detail stream forwarded to
 *   browsers (independent of the bridge's own seq numbering).
 * - Keep a HistoryBuffer of detail messages for browser replay.
 * - Track which browser connections are subscribed to each instance's detail.
 * - Detect stale instances (no bridge message within STALE_MS).
 */

import type {
  BridgeHello,
  BridgeReset,
  BridgePatch,
  InstanceReset,
  InstancePatch,
} from "@gsd/web-protocol";
import type { WebUiState } from "@gsd/web-protocol";
import { applySectionDelta } from "@gsd/web-protocol";
import { HistoryBuffer } from "./history-buffer.js";

/** Minimal send interface stored by the registry — no Elysia types here. */
export interface WsConn {
  readonly id: string;
  send(data: string): unknown;
}

/** One browser connection's subscription to an instance's detail stream. */
export interface DetailSubscription {
  conn: WsConn;
  /** null means all sections; non-null means only the listed keys. */
  sections: string[] | null;
}

export interface InstanceEntry {
  instanceId: string;
  /** Latest metadata from the bridge's hello handshake; refreshed on reconnect. */
  meta: BridgeHello;
  /** Live connection; null between disconnect and next hello from the bridge. */
  conn: WsConn | null;
  /** Full cached state assembled from sequential bridge resets and patches. */
  latestState: WebUiState | null;
  /** Next seq to assign for this instance's detail stream to browsers. */
  nextDetailSeq: number;
  /** History buffer of detail messages (InstanceReset / InstancePatch) sent to browsers. */
  readonly detailHistory: HistoryBuffer<InstanceReset | InstancePatch>;
  /** Server-received time of the last bridge message; used for stale detection. */
  lastSeenAt: number;
  stale: boolean;
}

/** Time without any bridge message before an instance is considered stale. */
const STALE_MS = 30_000;

export class InstanceRegistry {
  /** instanceId -> entry */
  private readonly entries = new Map<string, InstanceEntry>();
  /**
   * ws.id -> instanceId index.
   * Required so close events (which only carry the ws reference) can
   * find the right entry without scanning the whole map.
   */
  private readonly connIndex = new Map<string, string>();
  /** instanceId -> (connId -> subscription) */
  private readonly detailSubs = new Map<
    string,
    Map<string, DetailSubscription>
  >();

  /**
   * Register a new bridge connection, or replace the live connection for an
   * already-known instance.
   *
   * On reconnect the existing cached state and history are preserved so
   * browsers can resume with replay rather than requiring a full reset.
   */
  register(hello: BridgeHello, conn: WsConn): InstanceEntry {
    const existing = this.entries.get(hello.instanceId);
    if (existing) {
      // Remove the old conn from the index before overwriting it.
      if (existing.conn) {
        this.connIndex.delete(existing.conn.id);
      }
      existing.conn = conn;
      existing.meta = hello;
      existing.stale = false;
      existing.lastSeenAt = Date.now();
      this.connIndex.set(conn.id, hello.instanceId);
      return existing;
    }

    const entry: InstanceEntry = {
      instanceId: hello.instanceId,
      meta: hello,
      conn,
      latestState: null,
      nextDetailSeq: 1,
      detailHistory: new HistoryBuffer(),
      lastSeenAt: Date.now(),
      stale: false,
    };
    this.entries.set(hello.instanceId, entry);
    this.connIndex.set(conn.id, hello.instanceId);
    return entry;
  }

  /**
   * Mark the connection identified by connId as gone.
   *
   * Only nulls out entry.conn if this ws is still the current live connection —
   * a reconnect may have already replaced it before the old close event fires.
   */
  disconnect(connId: string): InstanceEntry | undefined {
    const instanceId = this.connIndex.get(connId);
    if (!instanceId) return undefined;
    const entry = this.entries.get(instanceId);
    if (!entry) return undefined;
    if (entry.conn?.id === connId) {
      entry.conn = null;
    }
    this.connIndex.delete(connId);
    return entry;
  }

  /**
   * Apply a full-state reset from the bridge.
   * Stores the new state and emits an InstanceReset (manager->browser format)
   * which is also pushed into the detail history for future replay.
   */
  applyReset(instanceId: string, msg: BridgeReset): InstanceReset | null {
    const entry = this.entries.get(instanceId);
    if (!entry) return null;
    entry.latestState = msg.state;
    entry.lastSeenAt = Date.now();
    const out: InstanceReset = {
      type: "instance.reset",
      instanceId,
      seq: entry.nextDetailSeq++,
      state: msg.state,
    };
    entry.detailHistory.push(out);
    return out;
  }

  /**
   * Apply a section patch from the bridge.
   *
   * Uses applySectionDelta from the protocol to keep latestState fully current
   * (array patches are resolved so derivations like overview always see the
   * up-to-date scalar values, not unresolved patch ops).
   *
   * Returns null if the instance is unknown or has no baseline state — a patch
   * cannot be applied without a preceding reset.
   */
  applyPatch(instanceId: string, msg: BridgePatch): InstancePatch | null {
    const entry = this.entries.get(instanceId);
    if (!entry || !entry.latestState) return null;
    entry.latestState = applySectionDelta(entry.latestState, {
      seq: msg.seq,
      kind: "patch",
      sections: msg.sections,
    });
    entry.lastSeenAt = Date.now();
    const out: InstancePatch = {
      type: "instance.patch",
      instanceId,
      seq: entry.nextDetailSeq++,
      sections: msg.sections,
    };
    entry.detailHistory.push(out);
    return out;
  }

  /** Update last-seen timestamp and clear stale flag on any heartbeat receipt. */
  heartbeat(instanceId: string): void {
    const entry = this.entries.get(instanceId);
    if (!entry) return;
    entry.lastSeenAt = Date.now();
    entry.stale = false;
  }

  /**
   * Build an InstanceReset suitable for delivering to a newly-subscribed
   * browser.  Returns null if the instance has no state yet (bridge has not
   * sent its first reset).
   */
  buildDetailReset(instanceId: string): InstanceReset | null {
    const entry = this.entries.get(instanceId);
    if (!entry || !entry.latestState) return null;
    return {
      type: "instance.reset",
      instanceId,
      seq: entry.nextDetailSeq - 1,
      state: entry.latestState,
    };
  }

  getByConnId(connId: string): InstanceEntry | undefined {
    const instanceId = this.connIndex.get(connId);
    return instanceId ? this.entries.get(instanceId) : undefined;
  }

  getById(instanceId: string): InstanceEntry | undefined {
    return this.entries.get(instanceId);
  }

  getAll(): InstanceEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Sweep all connected instances for staleness.
   * Returns entries that transitioned from live to stale in this sweep.
   * Only connected instances are checked — disconnected ones are already gone.
   */
  checkStale(): InstanceEntry[] {
    const now = Date.now();
    const becameStale: InstanceEntry[] = [];
    for (const entry of this.entries.values()) {
      if (
        !entry.stale &&
        entry.conn !== null &&
        now - entry.lastSeenAt > STALE_MS
      ) {
        entry.stale = true;
        becameStale.push(entry);
      }
    }
    return becameStale;
  }

  // ── detail subscriber management ─────────────────────────────────────────

  addDetailSub(instanceId: string, sub: DetailSubscription): void {
    let subs = this.detailSubs.get(instanceId);
    if (!subs) {
      subs = new Map();
      this.detailSubs.set(instanceId, subs);
    }
    subs.set(sub.conn.id, sub);
  }

  removeDetailSub(instanceId: string, connId: string): void {
    this.detailSubs.get(instanceId)?.delete(connId);
  }

  /** Remove a browser from all instance subscriptions on browser disconnect. */
  removeFromAll(connId: string): void {
    for (const subs of this.detailSubs.values()) {
      subs.delete(connId);
    }
  }

  getDetailSubs(instanceId: string): DetailSubscription[] {
    return [...(this.detailSubs.get(instanceId)?.values() ?? [])];
  }
}
