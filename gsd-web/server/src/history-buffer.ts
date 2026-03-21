/**
 * Fixed-size ring buffer for protocol messages ordered by seq.
 *
 * Replay semantics: a subscriber reconnects with the seq of the last message
 * it received.  We try to deliver everything from seq+1 onward.  If that seq
 * is outside the buffer or there is a gap in the retained run, we return null
 * and the caller must fall back to a full reset instead.
 */
const DEFAULT_MAX = 64;

export class HistoryBuffer<T extends { seq: number }> {
  private readonly max: number;
  private readonly buf: T[] = [];

  constructor(max = DEFAULT_MAX) {
    this.max = max;
  }

  push(entry: T): void {
    this.buf.push(entry);
    if (this.buf.length > this.max) {
      this.buf.shift();
    }
  }

  /**
   * Return all buffered entries whose seq >= fromSeq, provided they form a
   * contiguous run starting exactly at fromSeq.
   *
   * Returns null when:
   * - fromSeq is not present in the buffer (too old, or nothing buffered yet)
   * - there is a gap in the retained run (should not happen in practice but
   *   guards against bugs that would corrupt client state)
   */
  replayFrom(fromSeq: number): T[] | null {
    const start = this.buf.findIndex((e) => e.seq === fromSeq);
    if (start === -1) return null;
    const slice = this.buf.slice(start);
    for (let i = 1; i < slice.length; i++) {
      // Contiguity check: each entry must be exactly one ahead of the previous.
      if (slice[i]!.seq !== slice[i - 1]!.seq + 1) return null;
    }
    return slice;
  }

  clear(): void {
    this.buf.length = 0;
  }
}
