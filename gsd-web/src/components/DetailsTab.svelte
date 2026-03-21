<script lang="ts">
  import type { WebDashboardState, WebStatusState } from '@gsd/web-protocol';
  import {
    formatCost,
    formatDuration,
    formatElapsed,
    formatRelativeTime,
    formatTokens,
  } from '../utils';

  interface Props {
    statusState: WebStatusState | null;
    dashboardState: WebDashboardState | null;
  }

  let { statusState, dashboardState }: Props = $props();

  // True when we have any meaningful data to show beyond empty-state cards.
  let hasAnyData = $derived(
    Boolean(dashboardState?.currentUnit)
    || Boolean(statusState?.timeline?.length)
    || Boolean(statusState?.phaseMetrics?.length)
    || Boolean(statusState?.sliceMetrics?.length)
    || Boolean(statusState?.milestoneMetrics?.length)
    || Boolean(statusState?.modelMetrics?.length)
    || Boolean(statusState?.workers?.length)
    || Boolean(dashboardState?.session?.connected),
  );

  function reversed<T>(arr: T[]): T[] {
    return [...arr].reverse();
  }

  // Timeline entries can repeat the same unit id when a task shows up in
  // multiple recent events, so keyed rows need a per-occurrence suffix rather
  // than assuming the unit id is globally unique within the rendered window.
  function recentTimelineEntries(entries: NonNullable<WebStatusState['timeline']>) {
    return reversed(entries).map((entry, index) => ({
      entry,
      key: `${entry.id}/${index}`,
    }));
  }

  // Surface the milestone/slice/task scope in the timeline row so operators can
  // see what work a unit belonged to without opening the underlying reports.
  function formatUnitScope(unitId: string): string {
    const [milestone, slice, task] = unitId.split('/');
    return [milestone, slice, task].filter(Boolean).join(' / ');
  }

  function normalizeTs(startedAt: number | string): number {
    return typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt;
  }

  function workerStateMod(state: string): string {
    if (state === 'running') return 'badge-green';
    if (state === 'done' || state === 'idle') return 'badge-dim';
    if (state === 'error' || state === 'failed') return 'badge-red';
    return 'badge-yellow';
  }

  function formatSpend(cost: number, units: number): string {
    if (cost > 0) return formatCost(cost);
    const suffix = units === 1 ? 'unit' : 'units';
    return `${units} ${suffix}`;
  }
</script>

<div class="details-tab">
  <!-- Session overview card — always visible when connected, gives context even before tasks start -->
  {#if dashboardState?.session}
    <section class="card">
      <div class="card-header">
        <span class="card-title">Session</span>
        <span class="badge {dashboardState.session.connected ? 'badge-green' : 'badge-dim'}">
          {dashboardState.session.connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div class="session-grid">
        {#if dashboardState.session.model}
          <span class="label-dim">Model</span>
          <span class="label-primary">{dashboardState.session.model}</span>
        {/if}
        {#if dashboardState.session.messageCount != null}
          <span class="label-dim">Messages</span>
          <span class="label-secondary">{String(dashboardState.session.messageCount)}</span>
        {/if}
        {#if dashboardState.session.isStreaming}
          <span class="label-dim">Status</span>
          <span class="label-blue">Streaming</span>
        {/if}
      </div>
    </section>
  {/if}

  <section class="card">
    <div class="card-header">
      <span class="card-title">Current Task</span>
      {#if dashboardState?.currentUnit}
        <span class="in-progress">
          <span class="pulse-dot"></span>
          In Progress
        </span>
      {/if}
    </div>

    {#if dashboardState?.currentUnit}
      <div class="current-task">
        <div class="task-row">
          <span class="badge badge-blue">{dashboardState.currentUnit.type}</span>
          <span class="task-id">{dashboardState.currentUnit.id}</span>
        </div>
        {#if dashboardState.currentUnit.startedAt != null}
          <div class="task-elapsed">
            <span class="label-dim">Elapsed: </span>
            <span>{formatElapsed(normalizeTs(dashboardState.currentUnit.startedAt as number | string))}</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="empty-state">No active task</div>
    {/if}
  </section>

  <section class="card">
    <div class="card-header">
      <span class="card-title">Task Timeline</span>
      <span class="card-count">{String(statusState?.timeline?.length ?? 0)}</span>
    </div>

    {#if (statusState?.timeline?.length ?? 0) > 0}
      <div class="table-wrap">
        <div class="row-grid row-header">
          <span>Type</span>
          <span>ID</span>
          <span>Model</span>
          <span>Duration</span>
          <span>Spend</span>
        </div>
        {#each recentTimelineEntries(statusState?.timeline ?? []) as item (item.key)}
          <div class="row-grid row-data">
            <span class="badge badge-type">{item.entry.type}</span>
            <span class="label-dim col-overflow timeline-scope">{formatUnitScope(item.entry.id)}</span>
            <span class="label-dim col-overflow">{item.entry.model ?? '—'}</span>
            <span class="label-secondary">{formatDuration(item.entry.startedAt, item.entry.finishedAt ?? Date.now())}</span>
            <span class="label-green">{formatSpend(item.entry.cost ?? 0, 1)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">No timeline entries</div>
    {/if}
  </section>

  <section class="card">
    <div class="card-header">
      <span class="card-title">Phase Metrics</span>
    </div>

    {#if (statusState?.phaseMetrics?.length ?? 0) > 0}
      <div class="table-wrap">
        <div class="row-grid4 row-header">
          <span>Label</span>
          <span>Units</span>
          <span>Spend</span>
          <span>Tokens</span>
        </div>
        {#each statusState?.phaseMetrics ?? [] as metric (metric.label)}
          <div class="row-grid4 row-data">
            <span class="label-primary col-overflow">{metric.label}</span>
            <span class="label-secondary">{String(metric.units)}</span>
            <span class="label-green">{formatSpend(metric.cost ?? 0, metric.units ?? 0)}</span>
            <span class="label-blue">{formatTokens(metric.tokens ?? 0)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">No phase metrics</div>
    {/if}
  </section>

  <section class="card">
    <div class="card-header">
      <span class="card-title">Slice Metrics</span>
    </div>

    {#if (statusState?.sliceMetrics?.length ?? 0) > 0}
      <div class="table-wrap">
        <div class="row-grid4 row-header">
          <span>Label</span>
          <span>Units</span>
          <span>Spend</span>
          <span>Tokens</span>
        </div>
        {#each statusState?.sliceMetrics ?? [] as metric (metric.label)}
          <div class="row-grid4 row-data">
            <span class="label-primary col-overflow">{metric.label}</span>
            <span class="label-secondary">{String(metric.units)}</span>
            <span class="label-green">{formatSpend(metric.cost ?? 0, metric.units ?? 0)}</span>
            <span class="label-blue">{formatTokens(metric.tokens ?? 0)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">No slice metrics</div>
    {/if}
  </section>

  <section class="card">
    <div class="card-header">
      <span class="card-title">Milestone Metrics</span>
    </div>

    {#if (statusState?.milestoneMetrics?.length ?? 0) > 0}
      <div class="table-wrap">
        <div class="row-grid4 row-header">
          <span>Label</span>
          <span>Units</span>
          <span>Spend</span>
          <span>Tokens</span>
        </div>
        {#each statusState?.milestoneMetrics ?? [] as metric (metric.label)}
          <div class="row-grid4 row-data">
            <span class="label-primary col-overflow">{metric.label}</span>
            <span class="label-secondary">{String(metric.units)}</span>
            <span class="label-green">{formatSpend(metric.cost ?? 0, metric.units ?? 0)}</span>
            <span class="label-blue">{formatTokens(metric.tokens ?? 0)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">No milestone metrics</div>
    {/if}
  </section>

  <section class="card">
    <div class="card-header">
      <span class="card-title">Model Metrics</span>
    </div>

    {#if (statusState?.modelMetrics?.length ?? 0) > 0}
      <div class="table-wrap">
        <div class="row-grid4 row-header">
          <span>Label</span>
          <span>Units</span>
          <span>Spend</span>
          <span>Tokens</span>
        </div>
        {#each statusState?.modelMetrics ?? [] as metric (metric.label)}
          <div class="row-grid4 row-data">
            <span class="label-primary col-overflow">{metric.label}</span>
            <span class="label-secondary">{String(metric.units)}</span>
            <span class="label-green">{formatSpend(metric.cost ?? 0, metric.units ?? 0)}</span>
            <span class="label-blue">{formatTokens(metric.tokens ?? 0)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">No model metrics</div>
    {/if}
  </section>

  <section class="card">
    <div class="card-header">
      <span class="card-title">Workers</span>
      <span class="card-count">{String(statusState?.workers?.length ?? 0)}</span>
    </div>

    {#if (statusState?.workers?.length ?? 0) > 0}
      <div class="workers-list">
        {#each statusState?.workers ?? [] as worker (worker.pid)}
          <div class="worker-row">
            <div class="worker-main">
              <span class={`badge ${workerStateMod(worker.state)}`}>{worker.state}</span>
              <span class="worker-pid">PID {worker.pid}</span>
              {#if worker.milestoneId}
                <span class="label-dim col-overflow worker-milestone">{worker.milestoneId}</span>
              {/if}
            </div>
            <div class="worker-meta">
              <span class="label-green">{formatCost(worker.cost ?? 0)}</span>
              {#if worker.lastHeartbeat}
                <span class="label-dim">{formatRelativeTime(worker.lastHeartbeat)}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">No active workers</div>
    {/if}
  </section>
</div>

<style>
  .details-tab {
    overflow-y: auto;
    flex: 1;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .card {
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.75rem;
    padding: 0.75rem;
  }

  .session-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.75rem;
    row-gap: 0.25rem;
    font-size: 0.8rem;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .card-title {
    flex: 1;
    font-size: 0.72rem;
    font-weight: 600;
    color: #e7eef7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .card-count {
    font-size: 0.68rem;
    color: #94a3b8;
    background: rgba(148, 163, 184, 0.1);
    padding: 0.1rem 0.45rem;
    border-radius: 0.5rem;
  }

  .in-progress {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.68rem;
    color: #4ade80;
  }

  .pulse-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
    flex-shrink: 0;
    animation: pulse 1.6s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.7); }
  }

  .current-task {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .task-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .task-id {
    font-size: 0.8rem;
    color: #cbd5e1;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    word-break: break-all;
  }

  .task-elapsed {
    font-size: 0.78rem;
    color: #e7eef7;
  }

  .badge {
    display: inline-block;
    flex-shrink: 0;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0.1rem 0.42rem;
    border-radius: 0.35rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .badge-blue {
    background: rgba(59, 130, 246, 0.18);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.28);
  }

  .badge-green {
    background: rgba(74, 222, 128, 0.14);
    color: #4ade80;
    border: 1px solid rgba(74, 222, 128, 0.28);
  }

  .badge-red {
    background: rgba(248, 113, 113, 0.14);
    color: #f87171;
    border: 1px solid rgba(248, 113, 113, 0.28);
  }

  .badge-yellow {
    background: rgba(250, 204, 21, 0.12);
    color: #facc15;
    border: 1px solid rgba(250, 204, 21, 0.25);
  }

  .badge-dim {
    background: rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }

  .badge-type {
    background: rgba(148, 163, 184, 0.1);
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.18);
  }

  .table-wrap {
    border-radius: 0.45rem;
    overflow: hidden;
  }

  .row-grid {
    display: grid;
    grid-template-columns: 0.7fr 1.1fr 1fr 0.7fr 0.6fr;
    gap: 0.4rem;
    align-items: center;
  }

  .row-grid4 {
    display: grid;
    grid-template-columns: 1.4fr 0.5fr 0.6fr 0.7fr;
    gap: 0.4rem;
    align-items: center;
  }

  .row-header {
    padding: 0.28rem 0.5rem;
    font-size: 0.64rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: rgba(148, 163, 184, 0.05);
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .row-data {
    padding: 0.32rem 0.5rem;
    font-size: 0.76rem;
  }

  .timeline-scope {
    font-size: 0.68rem;
  }

  .row-data:nth-child(even) {
    background: rgba(148, 163, 184, 0.03);
  }

  .workers-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .worker-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.45rem 0.55rem;
    border-radius: 0.5rem;
    background: rgba(148, 163, 184, 0.04);
    border: 1px solid rgba(148, 163, 184, 0.08);
  }

  .worker-main {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .worker-meta {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-size: 0.72rem;
    padding-left: 0.1rem;
  }

  .worker-pid {
    font-size: 0.76rem;
    color: #cbd5e1;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .worker-milestone {
    max-width: 11rem;
  }

  .label-primary { color: #e7eef7; }
  .label-secondary { color: #cbd5e1; }
  .label-dim { color: #94a3b8; }
  .label-green { color: #86efac; }
  .label-blue { color: #93c5fd; }

  .col-overflow {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    font-size: 0.78rem;
    color: #94a3b8;
    text-align: center;
    padding: 0.75rem 0;
  }

  @media (min-width: 768px) {
    .worker-row {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .worker-main {
      flex: 1;
      min-width: 0;
    }
  }
</style>