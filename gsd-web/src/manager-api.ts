import { treaty } from "@elysiajs/eden";

import { createManagerBackendOrigin } from "./manager-origin";

/**
 * Use Eden as the browser's HTTP client for bootstrap/detail snapshots.
 *
 * The shim at src/elysia-eden-shim.d.ts provides the typed EdenClient contract
 * without importing the live server app type. This keeps the client tree fully
 * independent of server source and avoids pulling Bun/Node-only declarations
 * into the Vite/browser build context.
 */
export function createManagerApi() {
  return treaty(createManagerBackendOrigin());
}
