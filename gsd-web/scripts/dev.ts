/**
 * Development launcher: starts the Elysia API server (port 3000) and the Vite
 * dev server (port 3000) concurrently. The browser visits http://localhost:3000/;
 * Vite proxies all /api/* requests to the Elysia process.
 */

import { fileURLToPath } from "node:url";

const packageRoot = new URL("..", import.meta.url);
const serverEntry = fileURLToPath(new URL("server/src/index.ts", packageRoot));
const viteEntry = fileURLToPath(
  new URL("node_modules/vite/bin/vite.js", packageRoot),
);

const api = Bun.spawn(
  [process.execPath, "run", "--watch", serverEntry],
  {
    env: { ...process.env, PORT: "3000" },
    stdout: "inherit",
    stderr: "inherit",
  },
);

// Vite's websocket proxy expects Node's socket behavior; running it under Bun
// triggers a proxy teardown error that closes the browser connection on open.
const vite = Bun.spawn(
  ["node", viteEntry, "--port", "3000", "--host", "0.0.0.0"],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);

function shutdown() {
  api.kill();
  vite.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const [apiCode, viteCode] = await Promise.all([api.exited, vite.exited]);
process.exit(apiCode || viteCode || 0);

export {};
