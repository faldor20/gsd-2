# GSD Web Manager Progress

## Goal

Replace the original single-session headless web UI with a multi-instance manager that can:

- accept many attached local GSD bridges
- keep the existing diff-first state-sync model
- let one browser switch between instances from a single UI
- reuse the existing `WebUiState` sections instead of inventing a second detail model

## Architecture landed

The first vertical slice is in place across three layers:

### 1. Shared protocol

Canonical contract lives in `packages/gsd-web-protocol`.

Current shared pieces:

- `WebUiState` / `WebUiSection`
- compact overview state for the instance list
- browser ↔ manager message envelopes
- bridge ↔ manager message envelopes
- section delta helpers for reset / patch / replay

### 2. Local bridge runtime

Main-repo files added for the local-instance side:

- `src/web-runtime/instance-runtime.ts`
- `src/web-bridge.ts`
- `src/web-runtime/ws.d.ts`

Current behavior:

- one local `RpcClient` per bridge instance
- full state reset on connect / reconnect
- patch stream between resets
- 30s heartbeat
- reconnect backoff
- manager command routing for prompt / action / question response

### 3. Web manager backend

Manager backend currently lives under `gsd-web/server/src`.

Implemented pieces:

- `instance-registry.ts` keeps authoritative per-instance state and browser detail subscriptions
- `overview-store.ts` derives the compact instance overview from cached detail state
- `history-buffer.ts` supports contiguous replay or reset fallback
- WebSocket routes:
  - `/ws/instance`
  - `/ws/browser`

### 4. Ripple frontend

Frontend now lives directly in `gsd-web/src`.

Implemented pieces:

- manager shell UI in `App.ripple`
- manager browser transport in `manager-client.ts`
- instance overview list
- selected-instance detail pane
- prompt / action / question controls
- recent messages / files / logs / status rendering

## Verified so far

Earlier verification for the initial slice covered:

- protocol package typecheck
- frontend typecheck
- backend typecheck
- LSP diagnostics across frontend, backend, and bridge/runtime files
- dev startup for the manager server and Vite frontend

## Current command paths

- Manager UI dev flow: `npm run dev` from `gsd-web/`
- Local instance attach flow:
  - `gsd web attach --manager ws://localhost:3000/ws/instance`

## Known gaps before this follow-up

These are the issues being addressed in the current pass:

- browser WebSocket client connects, but no instance state reaches the UI
- frontend did not yet use Elysia Eden for typed API access
- `gsd-web/` moved to a top-level package, so local file dependency paths need to align with the new npm-managed layout
- old single-instance serve path in the main repo still exists and has not been fully removed yet

## Root cause found during this follow-up

The manager backend currently assumes incoming WebSocket frames arrive as raw strings or buffers and tries to `JSON.parse` them itself.

Elysia parses stringified JSON WebSocket frames into objects by default, so valid browser and bridge messages are being dropped before routing. That explains the current symptom where the browser shows a live connection but never receives overview/detail state.

## Next work in this pass

1. Fix manager WebSocket message decoding so browser and bridge traffic actually routes.
2. Introduce Eden-backed typed HTTP bootstrap/snapshot routes for the frontend.
3. Wire the Ripple client to Eden for initial manager state and selected-instance snapshots.
4. Re-run focused verification with the npm-managed `gsd-web/` package.
