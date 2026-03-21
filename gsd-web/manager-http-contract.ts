import type { OverviewState, WebUiState } from "@gsd/web-protocol";

/**
 * Shared HTTP payloads for the Eden bootstrap endpoints.
 *
 * They live outside the nested server scaffold so the frontend and server can
 * share one snapshot shape even though the current npm layout resolves `elysia`
 * through different package roots.
 */
export interface ManagerBootstrapPayload {
  overview: OverviewState;
  overviewSeq: number;
  recommendedInstanceId: string | null;
}

export interface ManagerInstanceSnapshot {
  instanceId: string;
  instanceSeq: number;
  state: Partial<WebUiState> | null;
}
