/**
 * Minimal ambient types for the `ws` package (v8).
 * Only the subset used by the bridge is declared; widen if you need more.
 */
declare module 'ws' {
  export class WebSocket {
    static readonly CONNECTING: 0
    static readonly OPEN: 1
    static readonly CLOSING: 2
    static readonly CLOSED: 3

    constructor(url: string)
    readonly readyState: 0 | 1 | 2 | 3

    send(data: string, cb?: (error?: Error) => void): void
    close(code?: number, reason?: string): void

    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    off(event: string, listener: (...args: unknown[]) => void): this
  }

  export default WebSocket
}
