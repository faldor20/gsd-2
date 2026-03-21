# GSD Web

Svelte frontend + Elysia backend for the GSD web app.

## What runs where

- `src/` is the Svelte client
- `server/src/app.ts` exports the shared Elysia app type and routes
- `server/src/index.ts` starts the API server in dev and serves the built app in prod
- `scripts/dev.ts` launches the Vite dev server and the Elysia API server together

## Development

1. Install dependencies:

   ```bash
   bun install
   ```

2. Start the dev server:

   ```bash
   bun run dev
   ```

   This starts two processes:
   - Vite dev server on `http://localhost:3000` (browser goes here, HMR enabled)
   - Elysia API server on `http://localhost:3001` (API routes only)

   Vite proxies every `/api/*` request to the Elysia process, so the browser always uses a single origin (`localhost:3000`).

3. Open the app in your browser:

   ```text
   http://localhost:3000/
   ```

## How to test the root page

The app is served from `/`. If you see `NOT_FOUND`, the dev server is not running correctly or you opened the API server directly instead of Vite.

Check the root route directly:

```bash
curl -i http://localhost:3000/
```

You should get HTML with the Svelte app shell, not a 404.

## How to test the API message route

```bash
curl http://localhost:3000/api/message
```

Expected: `{"message":"Hello from Elysia and Eden."}`

## How to test SSE

```bash
curl -N http://localhost:3000/api/events
```

You should see a `connected` event, three `heartbeat` events (one per second), and a `done` event. Vite proxies this to the Elysia process transparently.

The "Connect stream" button on the app page does the same through the browser.

## Build

```bash
bun run build
```

This produces the client bundle in `dist/`.

## Preview

Use the preview launcher to serve the built client with Vite Preview while the
manager backend listens on an exposed interface:

```bash
bun run preview
```

That starts:

- Vite Preview on `http://0.0.0.0:4173/`
- Elysia on `http://0.0.0.0:3001/`

The browser client points its API and WebSocket traffic at the backend port,
so opening the preview URL still exercises the live manager process.

To test the production server directly:

```bash
bun run server
curl -i http://localhost:3001/
curl http://localhost:3001/api/message
curl -N http://localhost:3001/api/events
```

## Notes

- The client uses `@elysiajs/eden` for typed API access.
- The SSE helper is intentionally simple for now; it is meant to be extended later with richer parsing and reconnection behavior.
- Static assets (`/assets/*.js`, `/assets/*.css`) are served by Vite in dev and by Elysia's file-existence check in prod — the SPA fallback only fires for routes that have no matching file in `dist/`.
