const managerServerPort = Number.parseInt(
  import.meta.env.VITE_MANAGER_SERVER_PORT ?? "3000",
  10,
);

/**
 * Keep browser API calls aligned with the process that owns the manager backend.
 *
 * In dev we stay same-origin so Vite's proxy handles `/api` and WebSocket traffic.
 * In preview we retarget the browser to the exposed backend port on the same host.
 */
export function createManagerBackendOrigin(): string {
  if (import.meta.env.DEV) {
    return location.origin;
  }

  if (location.port === String(managerServerPort)) {
    return location.origin;
  }

  return `${location.protocol}//${location.hostname}:${managerServerPort}`;
}

export function createManagerWebSocketUrl(): string {
  const origin = createManagerBackendOrigin();
  const websocketProtocol = origin.startsWith("https:") ? "wss:" : "ws:";
  const { host } = new URL(origin);

  return `${websocketProtocol}//${host}/ws/browser`;
}