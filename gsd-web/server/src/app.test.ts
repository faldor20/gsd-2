import { describe, expect, test } from "bun:test";

import type { BridgeHello, BridgeReset, WebUiState } from "@gsd/web-protocol";

import { createManagerHttpApi } from "./api.js";
import { coerceProtocolMessage } from "./app.js";
import { InstanceRegistry } from "./instance-registry.js";
import { OverviewStore } from "./overview-store.js";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function createBridgeHello(): BridgeHello {
  return {
    type: "instance.hello",
    instanceId: "inst-1",
    projectName: "demo-project",
    cwd: "/tmp/demo-project",
    hostLabel: "local",
    version: "test",
  };
}

function createBridgeReset(): BridgeReset {
  const state: WebUiState = {
    dashboard: {
      projectName: "demo-project",
      phase: "active",
      autoModeRunning: false,
      autoModePaused: false,
      currentUnit: null,
      next: null,
      activeMilestone: null,
      activeSlice: null,
      blockers: [],
      actions: [],
      session: {
        connected: true,
        model: "claude",
        sessionId: "sess-1",
        messageCount: 2,
        pendingMessageCount: 0,
        isStreaming: false,
        totalCost: 0,
        totalTokens: 0,
        error: null,
      },
    },
    recentMessages: [
      { id: "m1", role: "user", text: "hello", timestamp: 1 },
      { id: "m2", role: "assistant", text: "world", timestamp: 2 },
    ],
    recentFiles: [],
    composer: {
      connected: true,
      disabled: false,
      submitLabel: "Send",
      placeholder: "Type a message",
      error: null,
    },
    questions: { pending: null },
    logs: [],
    status: {
      error: null,
      summary: {
        phase: "active",
        doneMilestones: 0,
        totalMilestones: 0,
        doneSlices: 0,
        totalSlices: 0,
        remainingSlices: 0,
        progressPercent: 0,
        cost: 0,
        tokens: 0,
        completionRate: 0,
        nextAction: "None",
      },
      blockers: [],
      milestones: [],
      timeline: [],
      phaseMetrics: [],
      modelMetrics: [],
      workers: [],
    },
  };

  return {
    type: "instance.reset",
    seq: 1,
    state,
  };
}

describe("manager transport helpers", () => {
  test("coerceProtocolMessage preserves objects Elysia already parsed", () => {
    const message = { type: "browser.subscribe", overview: true };

    expect(
      coerceProtocolMessage<{ type: string; overview: boolean }>(message),
    ).toEqual(message);
  });

  test("coerceProtocolMessage still accepts raw JSON strings", () => {
    const message = JSON.stringify({
      type: "browser.selectInstance",
      instanceId: "inst-1",
    });

    expect(
      coerceProtocolMessage<{ type: string; instanceId: string }>(message),
    ).toEqual({
      type: "browser.selectInstance",
      instanceId: "inst-1",
    });
  });
});

describe("manager eden api", () => {
  test("bootstrap recommends a live instance and detail snapshots include messages", async () => {
    const registry = new InstanceRegistry();
    const overviewStore = new OverviewStore();
    const connection = { id: "ws-1", send() {} };

    registry.register(createBridgeHello(), connection);
    registry.applyReset("inst-1", createBridgeReset());
    overviewStore.update(registry.getAll());

    const app = createManagerHttpApi({ registry, overviewStore });

    const bootstrapResponse = await app.handle(
      new Request("http://manager.test/api/bootstrap"),
    );
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = await readJson<{
      recommendedInstanceId: string | null;
      overview: { instances: unknown[] };
    }>(bootstrapResponse);
    expect(bootstrap.recommendedInstanceId).toBe("inst-1");
    expect(bootstrap.overview.instances).toHaveLength(1);

    const detailResponse = await app.handle(
      new Request("http://manager.test/api/instances/inst-1"),
    );
    expect(detailResponse.status).toBe(200);
    const detail = await readJson<{
      state: { recentMessages?: Array<{ text: string }> } | null;
    }>(detailResponse);
    expect(detail.state?.recentMessages?.[1]?.text).toBe("world");
  });
});
