/**
 * Preview launcher: runs a single Elysia server that handles both the HTTP/WS
 * API and serves the pre-built Vite client from dist/. This eliminates the
 * two-origin setup (Vite preview + API server) that causes CORS issues.
 *
 * PORT env var controls the listening port (default: 3000).
 */

import { fileURLToPath } from "node:url";

const packageRoot = new URL("..", import.meta.url);
const serverEntry = fileURLToPath(new URL("server/src/index.ts", packageRoot));

const server = Bun.spawn(
  [process.execPath, "run", serverEntry],
  {
    env: { ...process.env, HOST: process.env["HOST"] ?? "0.0.0.0", PORT: process.env["PORT"] ?? "3001" },
    stdout: "inherit",
    stderr: "inherit",
    
  },
);

function shutdown() {
  server.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.exit(await server.exited);

export {};