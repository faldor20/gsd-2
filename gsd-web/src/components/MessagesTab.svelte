<script lang="ts">
  import type { WebMessageSummary } from '@gsd/web-protocol';
  import { formatRelativeTime, messageHeading } from '../utils';

  interface Props {
    recentMessages: WebMessageSummary[];
  }

  let { recentMessages }: Props = $props();
</script>

<div class="tab-scroll">
  {#if recentMessages.length === 0}
    <div class="empty-state">
      <span class="empty-text">No messages yet</span>
    </div>
  {:else}
    <div class="message-list">
      {#each recentMessages as message (message.id)}
        <div class={`message-card role-${message.role}${message.pending ? ' is-pending' : ''}`}>
          <div class="message-header">
            <span class="message-heading">{messageHeading(message)}</span>
            <span class="message-time">{formatRelativeTime(message.timestamp)}</span>
          </div>
          <div class="message-body">{message.text}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tab-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-text {
    font-size: 0.82rem;
    color: #64748b;
  }

  .message-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .message-card {
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.75rem;
    padding: 0.6rem;
    border-left-width: 3px;
    word-break: break-word;
  }

  .role-user {
    border-left-color: rgba(96, 165, 250, 0.5);
  }

  .role-assistant {
    border-left-color: rgba(74, 222, 128, 0.5);
  }

  .is-pending {
    border-left-color: rgba(250, 204, 21, 0.6);
    animation: pulse-opacity 1.6s ease-in-out infinite;
  }

  @keyframes pulse-opacity {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.65; }
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .message-heading {
    font-size: 0.78rem;
    font-weight: 600;
    color: #e7eef7;
  }

  .message-time {
    font-size: 0.72rem;
    color: #64748b;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .message-body {
    font-size: 0.82rem;
    color: #cbd5e1;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  @media (min-width: 768px) {
    .tab-scroll {
      padding: 1rem;
    }

    .message-card {
      padding: 0.75rem;
    }
  }
</style>