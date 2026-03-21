<script lang="ts">
  import type { ManagedInstanceSummary } from '@gsd/web-protocol';
  import { formatRelativeTime, instanceStatusLabel } from '../utils';

  interface Props {
    instances: ManagedInstanceSummary[];
    onSelect: (instanceId: string) => void;
  }

  let { instances, onSelect }: Props = $props();
</script>

<div class="picker-scroll">
  {#if instances.length === 0}
    <div class="empty-state">
      <p class="empty-title">No instances attached</p>
      <p class="empty-sub">Run <code>gsd web attach</code> in a project directory to connect an instance.</p>
    </div>
  {:else}
    <div class="card-list">
      {#each instances as instance (instance.instanceId)}
        <button type="button" class="card" onclick={() => onSelect(instance.instanceId)}>
          <div class="card-top">
            <span class="card-name">{instance.displayName || instance.projectName}</span>
            <span
              class="status-dot"
              class:dot-offline={!instance.connected}
              class:dot-stale={instance.connected && instance.stale}
              class:dot-connected={instance.connected && !instance.stale}
            ></span>
          </div>

          <div class="card-project">{instance.projectName}</div>

          <div class="card-meta">{instance.hostLabel + ' · ' + instance.cwd}</div>

          <div class="card-bottom">
            <span class="card-status">{instanceStatusLabel(instance)}</span>
            <span class="card-time">{formatRelativeTime(instance.lastSeenAt)}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 3rem 1.5rem;
    text-align: center;
  }

  .empty-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: #e7eef7;
  }

  .empty-sub {
    margin: 0;
    font-size: 0.78rem;
    color: #94a3b8;
    line-height: 1.5;
  }

  .empty-sub code {
    font-family: ui-monospace, 'Cascadia Code', monospace;
    font-size: 0.78rem;
    color: #93c5fd;
    background: rgba(147, 197, 253, 0.1);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }

  .card-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    padding: 0.65rem;
    text-align: left;
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.75rem;
    color: #e7eef7;
    font-family: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .card:hover {
    border-color: rgba(148, 163, 184, 0.36);
    background: rgba(15, 23, 42, 0.92);
  }

  .card:active {
    background: rgba(30, 41, 59, 0.88);
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .card-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: #e7eef7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .dot-connected {
    background: #4ade80;
    box-shadow: 0 0 4px rgba(74, 222, 128, 0.5);
  }

  .dot-stale {
    background: #facc15;
  }

  .dot-offline {
    background: #f87171;
  }

  .card-project {
    font-size: 0.78rem;
    color: #94a3b8;
  }

  .card-meta {
    font-size: 0.75rem;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.15rem;
  }

  .card-status {
    font-size: 0.72rem;
    color: #cbd5e1;
  }

  .card-time {
    font-size: 0.72rem;
    color: #64748b;
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    .picker-scroll {
      padding: 1rem;
      max-width: 640px;
      margin: 0 auto;
    }

    .card {
      padding: 0.85rem;
    }
  }
</style>