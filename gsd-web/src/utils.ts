/**
 * Shared helper functions used across components.
 * Extracted from the monolithic App.ripple for reuse.
 */

// --- Time formatting ---

/** Relative timestamp display (e.g. "Just now", "5m ago", "2h ago"). */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "Unknown";

  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleString();
}

/** Human-friendly duration between two timestamps. */
export function formatDuration(startMs: number, endMs: number): string {
  const diffMs = endMs - startMs;
  if (diffMs < 1_000) return "<1s";
  if (diffMs < 60_000) return `${Math.round(diffMs / 1_000)}s`;
  const mins = Math.floor(diffMs / 60_000);
  const secs = Math.round((diffMs % 60_000) / 1_000);
  if (diffMs < 3_600_000) return `${mins}m ${secs}s`;
  const hrs = Math.floor(diffMs / 3_600_000);
  return `${hrs}h ${Math.round((diffMs % 3_600_000) / 60_000)}m`;
}

/** Elapsed time from a start timestamp to now. */
export function formatElapsed(startMs: number): string {
  return formatDuration(startMs, Date.now());
}

// --- Input helpers ---

/** Safely extract .value from an input/textarea event target. */
export function readTextControlValue(event: Event): string {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.value;
  }
  return "";
}

// --- Status/label helpers ---

/** One-word status label for an instance summary. */
export function instanceStatusLabel(instance: {
  connected: boolean;
  stale: boolean;
  hasPendingQuestion: boolean;
  isStreaming: boolean;
}): string {
  if (!instance.connected) return "Offline";
  if (instance.stale) return "Stale";
  if (instance.hasPendingQuestion) return "Question";
  if (instance.isStreaming) return "Streaming";
  return "Ready";
}

/** Heading text for a message card. */
export function messageHeading(message: {
  role: string;
  pending?: boolean;
}): string {
  if (message.role === "user") return "Prompt";
  return message.pending ? "Response · streaming" : "Response";
}

/** Label for the question submit button based on question method. */
export function questionButtonLabel(question: {
  method: string;
  allowMultiple: boolean;
}): string {
  if (question.method === "editor") return "Submit text";
  if (question.method === "select" && question.allowMultiple)
    return "Submit values";
  return "Submit response";
}

// --- Number formatting ---

/** Format a cost value as dollars. */
export function formatCost(cost: number): string {
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

/** Format a token count with k/M suffixes. */
export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
