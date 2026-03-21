import { Elysia, file } from "elysia";
import { join } from "node:path";

// Absolute path to the built client assets, resolved relative to this file so
// the server works regardless of the process working directory.
const DIST_DIR = join(import.meta.dir, "../../dist");

import {
  filterStateSections,
  type BridgeToManagerMessage,
  type BrowserCommandResult,
  type BrowserToManagerMessage,
  type InstancePatch,
  type InstanceReset,
  type ManagerActionCommand,
  type ManagerPromptCommand,
  type ManagerQuestionResponseCommand,
  type WebUiSection,
  type WebUiSectionsPayload,
} from "@gsd/web-protocol";

import { createManagerHttpApi } from "./api.js";
import { InstanceRegistry } from "./instance-registry.js";
import { OverviewStore } from "./overview-store.js";
import type { DetailSubscription, WsConn } from "./instance-registry.js";

interface BrowserConn {
  ws: WsConn;
  selectedInstanceId: string | null;
  sections: WebUiSection[] | null;
}

/**
 * Elysia parses stringified JSON WebSocket frames into objects before they reach
 * the route handler. The manager still accepts raw strings/binary payloads so
 * local tests and non-Elysia clients keep working.
 */
export function coerceProtocolMessage<T>(raw: unknown): T | null {
  if (typeof raw === "string") {
    return parseProtocolJson<T>(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return parseProtocolJson<T>(new TextDecoder().decode(new Uint8Array(raw)));
  }

  if (ArrayBuffer.isView(raw)) {
    return parseProtocolJson<T>(
      new TextDecoder().decode(
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      ),
    );
  }

  if (typeof raw === "object" && raw !== null) {
    return raw as T;
  }

  return null;
}

function parseProtocolJson<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

export function createApp() {
  const registry = new InstanceRegistry();
  const overviewStore = new OverviewStore();
  const browserConns = new Map<string, BrowserConn>();
  const pendingCommands = new Map<string, WsConn>();
  let cmdSeq = 0;

  function send(conn: WsConn, message: unknown): void {
    try {
      conn.send(JSON.stringify(message));
    } catch {
      // Connection cleanup is handled by the close event path.
    }
  }

  function broadcastOverview(message: unknown): void {
    for (const browser of browserConns.values()) {
      send(browser.ws, message);
    }
  }

  function filterDetail(
    message: InstanceReset | InstancePatch,
    sections: WebUiSection[] | null,
  ): InstanceReset | InstancePatch | null {
    if (!sections) return message;

    if (message.type === "instance.reset") {
      return {
        ...message,
        state: filterStateSections(message.state, sections),
      } as InstanceReset;
    }

    const filtered: WebUiSectionsPayload = {};
    for (const section of sections) {
      if (Object.prototype.hasOwnProperty.call(message.sections, section)) {
        (filtered as Record<string, unknown>)[section] = (
          message.sections as Record<string, unknown>
        )[section];
      }
    }

    if (Object.keys(filtered).length === 0) return null;
    return {
      ...message,
      sections: filtered,
    };
  }

  function fanOutDetail(message: InstanceReset | InstancePatch): void {
    for (const subscription of registry.getDetailSubs(message.instanceId)) {
      const filteredMessage = filterDetail(
        message,
        subscription.sections as WebUiSection[] | null,
      );
      if (filteredMessage) {
        send(subscription.conn, filteredMessage);
      }
    }
  }

  function sendOverviewToBrowser(
    ws: WsConn,
    lastSeenSeq: number | undefined,
  ): void {
    if (lastSeenSeq != null) {
      const replay = overviewStore.history.replayFrom(lastSeenSeq + 1);
      if (replay && replay.length > 0) {
        for (const message of replay) {
          send(ws, message);
        }
        return;
      }
    }

    const reset = overviewStore.buildReset();
    if (reset) {
      send(ws, reset);
    }
  }

  function sendDetailToBrowser(
    ws: WsConn,
    instanceId: string,
    sections: WebUiSection[] | null,
    lastSeenSeq: number | undefined,
  ): void {
    const entry = registry.getById(instanceId);
    if (!entry || !entry.latestState) return;

    if (lastSeenSeq != null) {
      const replay = entry.detailHistory.replayFrom(lastSeenSeq + 1);
      if (replay && replay.length > 0) {
        for (const message of replay) {
          const filteredMessage = filterDetail(message, sections);
          if (filteredMessage) {
            send(ws, filteredMessage);
          }
        }
        return;
      }
    }

    const reset = registry.buildDetailReset(instanceId);
    if (!reset) return;

    const filteredReset = filterDetail(reset, sections);
    if (filteredReset) {
      send(ws, filteredReset);
    }
  }

  function nextRequestId(): string {
    return `mgr-${++cmdSeq}-${Date.now()}`;
  }

  function handleInstanceMessage(ws: WsConn, raw: unknown): void {
    const message = coerceProtocolMessage<BridgeToManagerMessage>(raw);
    if (!message) {
      console.warn("[instance] unparseable message from", ws.id);
      return;
    }

    const entry = registry.getByConnId(ws.id);
    if (!entry && message.type !== "instance.hello") {
      console.warn(
        "[instance] received",
        message.type,
        "before hello from",
        ws.id,
        "— ignored",
      );
      return;
    }

    switch (message.type) {
      case "instance.hello": {
        registry.register(message, ws);
        const overviewMessage = overviewStore.update(registry.getAll());
        broadcastOverview(overviewMessage);
        console.log(
          "[instance] registered",
          message.instanceId,
          message.projectName,
        );
        return;
      }

      case "instance.reset": {
        if (!entry) return;
        const detailMessage = registry.applyReset(entry.instanceId, message);
        if (!detailMessage) return;

        const overviewMessage = overviewStore.update(registry.getAll());
        broadcastOverview(overviewMessage);
        fanOutDetail(detailMessage);
        return;
      }

      case "instance.patch": {
        if (!entry) return;
        const detailMessage = registry.applyPatch(entry.instanceId, message);
        if (!detailMessage) return;

        const overviewMessage = overviewStore.update(registry.getAll());
        broadcastOverview(overviewMessage);
        fanOutDetail(detailMessage);
        return;
      }

      case "instance.heartbeat": {
        if (!entry) return;
        const wasStale = entry.stale;
        registry.heartbeat(entry.instanceId);
        if (wasStale) {
          const overviewMessage = overviewStore.update(registry.getAll());
          broadcastOverview(overviewMessage);
        }
        return;
      }

      case "instance.commandResult": {
        const browserConn = pendingCommands.get(message.requestId);
        pendingCommands.delete(message.requestId);
        if (!browserConn) {
          console.warn(
            "[instance] commandResult for unknown requestId",
            message.requestId,
          );
          return;
        }

        const result: BrowserCommandResult = {
          type: "command.result",
          requestId: message.requestId,
          ok: message.ok,
          error: message.error,
        };
        send(browserConn, result);
        return;
      }
    }
  }

  function handleInstanceClose(ws: WsConn): void {
    const entry = registry.disconnect(ws.id);
    if (!entry) return;

    console.log("[instance] disconnected", entry.instanceId);
    const overviewMessage = overviewStore.update(registry.getAll());
    broadcastOverview(overviewMessage);
  }

  function handleBrowserMessage(ws: WsConn, raw: unknown): void {
    const message = coerceProtocolMessage<BrowserToManagerMessage>(raw);
    if (!message) {
      console.warn("[browser] unparseable message from", ws.id);
      return;
    }

    switch (message.type) {
      case "browser.subscribe": {
        const browser: BrowserConn = {
          ws,
          selectedInstanceId: message.instanceId ?? null,
          sections: (message.sections as WebUiSection[] | undefined) ?? null,
        };
        browserConns.set(ws.id, browser);

        sendOverviewToBrowser(ws, message.overviewSeq);

        if (message.instanceId) {
          const subscription: DetailSubscription = {
            conn: ws,
            sections: browser.sections,
          };
          registry.addDetailSub(message.instanceId, subscription);
          sendDetailToBrowser(
            ws,
            message.instanceId,
            browser.sections,
            message.instanceSeq,
          );
        }
        return;
      }

      case "browser.selectInstance": {
        const browser = browserConns.get(ws.id);
        if (!browser) return;

        if (browser.selectedInstanceId) {
          registry.removeDetailSub(browser.selectedInstanceId, ws.id);
        }

        browser.selectedInstanceId = message.instanceId;
        browser.sections =
          (message.sections as WebUiSection[] | undefined) ?? null;

        if (message.instanceId) {
          const subscription: DetailSubscription = {
            conn: ws,
            sections: browser.sections,
          };
          registry.addDetailSub(message.instanceId, subscription);
          sendDetailToBrowser(
            ws,
            message.instanceId,
            browser.sections,
            message.instanceSeq,
          );
        }
        return;
      }

      case "browser.prompt": {
        const instanceEntry = registry.getById(message.instanceId);
        if (!instanceEntry?.conn) {
          send(
            ws,
            errorResult(
              nextRequestId(),
              `instance ${message.instanceId} is not connected`,
            ),
          );
          return;
        }

        const requestId = nextRequestId();
        pendingCommands.set(requestId, ws);
        const command: ManagerPromptCommand = {
          type: "manager.prompt",
          requestId,
          message: message.message,
          promptMode: message.promptMode,
        };
        send(instanceEntry.conn, command);
        return;
      }

      case "browser.action": {
        const instanceEntry = registry.getById(message.instanceId);
        if (!instanceEntry?.conn) {
          send(
            ws,
            errorResult(
              nextRequestId(),
              `instance ${message.instanceId} is not connected`,
            ),
          );
          return;
        }

        const requestId = nextRequestId();
        pendingCommands.set(requestId, ws);
        const command: ManagerActionCommand = {
          type: "manager.action",
          requestId,
          action: message.action,
        };
        send(instanceEntry.conn, command);
        return;
      }

      case "browser.questionResponse": {
        const instanceEntry = registry.getById(message.instanceId);
        if (!instanceEntry?.conn) {
          send(
            ws,
            errorResult(
              nextRequestId(),
              `instance ${message.instanceId} is not connected`,
            ),
          );
          return;
        }

        const requestId = nextRequestId();
        pendingCommands.set(requestId, ws);
        const command: ManagerQuestionResponseCommand = {
          type: "manager.questionResponse",
          requestId,
          body: message.body,
        };
        send(instanceEntry.conn, command);
        return;
      }
    }
  }

  function handleBrowserClose(ws: WsConn): void {
    browserConns.delete(ws.id);
    registry.removeFromAll(ws.id);

    for (const [requestId, conn] of pendingCommands.entries()) {
      if (conn.id === ws.id) {
        pendingCommands.delete(requestId);
      }
    }
  }

  function errorResult(requestId: string, error: string): BrowserCommandResult {
    return {
      type: "command.result",
      requestId,
      ok: false,
      error,
    };
  }

  const staleSweep = setInterval(() => {
    const becameStale = registry.checkStale();
    if (becameStale.length > 0) {
      const overviewMessage = overviewStore.update(registry.getAll());
      broadcastOverview(overviewMessage);
    }
  }, 10_000);

  const app = new Elysia()
    .use(createManagerHttpApi({ registry, overviewStore }))
    .ws("/ws/instance", {
      open(ws) {
        console.log("[instance] connection opened", ws.id);
      },
      message(ws, message) {
        handleInstanceMessage(ws as unknown as WsConn, message);
      },
      close(ws) {
        handleInstanceClose(ws as unknown as WsConn);
      },
    })
    .ws("/ws/browser", {
      open(ws) {
        console.log("[browser] connection opened", ws.id);
      },
      message(ws, message) {
        handleBrowserMessage(ws as unknown as WsConn, message);
      },
      close(ws) {
        handleBrowserClose(ws as unknown as WsConn);
      },
    })
    // Serve the built Vite client — all non-API routes fall back to index.html
    // so the Svelte router handles client-side navigation.
    .get("/", () => file(`${DIST_DIR}/index.html`))
    .get("/*", async ({ request }) => {
      const { pathname } = new URL(request.url);
      const asset = Bun.file(`${DIST_DIR}${pathname}`);
      return (await asset.exists()) ? asset : file(`${DIST_DIR}/index.html`);
    })
    .onStop(() => {
      clearInterval(staleSweep);
    });

  return app;
}

export type App = ReturnType<typeof createApp>;
