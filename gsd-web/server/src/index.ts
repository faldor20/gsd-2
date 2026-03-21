import { createApp } from "./app.js";

// Default to port 3000 so the production server is reachable on the same
// port as the dev setup. The dev launcher overrides this to 3000 explicitly
// so that the Vite proxy can forward /api requests without collision.
const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
const hostname = process.env["HOST"] ?? "0.0.0.0";

/**
 * Keep process startup thin so the real manager contract lives in app.ts where
 * Eden, tests, and the production listener all share the same route graph.
 */
createApp().listen({ port, hostname });

console.log(`GSD web manager running on ${hostname}:${port}`);
