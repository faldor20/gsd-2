import { Elysia } from "elysia";

import {
  WEB_UI_SECTION_NAMES,
  filterStateSections,
  type OverviewState,
  type WebUiSection,
  type WebUiState,
} from "@gsd/web-protocol";

import type { InstanceRegistry } from "./instance-registry.js";
import type { OverviewStore } from "./overview-store.js";
import type {
  ManagerBootstrapPayload,
  ManagerInstanceSnapshot,
} from "../../manager-http-contract";

const ALL_WEB_UI_SECTIONS = [...WEB_UI_SECTION_NAMES] as WebUiSection[];

/**
 * The browser always needs a valid overview payload, even before the first bridge
 * connects. Returning an explicit empty shape keeps the Eden contract stable.
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
 * Parse a comma-separated section list from the query string.
 * Invalid names are ignored so a stale browser cannot break snapshot delivery.
 */
function parseSections(rawSections: string | undefined): WebUiSection[] | null {
  if (!rawSections) return null;

  const uniqueSections = new Set<WebUiSection>();
  for (const rawSection of rawSections.split(",")) {
    const section = rawSection.trim() as WebUiSection;
    if (WEB_UI_SECTION_NAMES.includes(section)) {
      uniqueSections.add(section);
    }
  }

  return uniqueSections.size > 0 ? [...uniqueSections] : [];
}

/**
 * Prefer a currently connected instance for the initial detail pane so operators
 * see useful state immediately after the app loads.
 */
function pickRecommendedInstanceId(overview: OverviewState): string | null {
  const recommended =
    overview.instances.find(
      (instance) => instance.connected && !instance.stale,
    ) ??
    overview.instances.find((instance) => instance.connected) ??
    overview.instances[0];

  return recommended?.instanceId ?? null;
}

function buildInstanceSnapshot(
  registry: InstanceRegistry,
  instanceId: string,
  sections: WebUiSection[] | null,
): ManagerInstanceSnapshot {
  const reset = registry.buildDetailReset(instanceId);
  if (!reset) {
    return {
      instanceId,
      instanceSeq: 0,
      state: null,
    };
  }

  return {
    instanceId,
    instanceSeq: reset.seq,
    state: filterStateSections(
      reset.state,
      sections ?? ALL_WEB_UI_SECTIONS,
    ) as Partial<WebUiState>,
  };
}

export interface ManagerHttpApiDeps {
  registry: InstanceRegistry;
  overviewStore: OverviewStore;
}

/**
 * Eden speaks to this HTTP surface while the custom WebSocket protocol keeps the
 * diff-first live stream. That split lets the browser bootstrap with typed
 * snapshots without weakening the existing patch/replay model.
 */
export function createManagerHttpApi({
  registry,
  overviewStore,
}: ManagerHttpApiDeps) {
  return new Elysia()
    .get("/api/bootstrap", (): ManagerBootstrapPayload => {
      const overview =
        overviewStore.getCurrentState() ?? createEmptyOverviewState();
      return {
        overview,
        overviewSeq: overviewStore.getCurrentSeq(),
        recommendedInstanceId: pickRecommendedInstanceId(overview),
      };
    })
    .get(
      "/api/instances/:instanceId",
      ({
        params,
        query,
      }: {
        params: { instanceId: string };
        query: { sections?: string };
      }): ManagerInstanceSnapshot => {
        return buildInstanceSnapshot(
          registry,
          params.instanceId,
          parseSections(query.sections),
        );
      },
    );
}

export { createEmptyOverviewState };
