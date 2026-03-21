<script lang="ts">
  import type { WebDashboardState, WebStatusState } from '@gsd/web-protocol';
  import { formatCost, formatTokens } from '../utils';

  interface Props {
    dashboardState: WebDashboardState | null;
    statusState: WebStatusState | null;
    onAction: (action: 'auto' | 'next' | 'pause' | 'stop' | 'abort') => void;
    onSendCommand: (command: string) => void;
  }

  let { dashboardState, statusState, onAction, onSendCommand }: Props = $props();

  let showModelSelector = $state(false);
  let customModel = $state('');

  function availableModels() {
    return dashboardState?.availableModels ?? [];
  }

  function formatContextWindow(tokens: number): string {
    if (!tokens) return 'context unknown';
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M ctx`;
    return `${Math.round(tokens / 1_000)}k ctx`;
  }

  function modelTitle(model: { value: string; contextWindow: number; reasoning: boolean }): string {
    const parts = [model.value, formatContextWindow(model.contextWindow)];
    if (model.reasoning) parts.push('reasoning');
    return parts.join(' • ');
  }

  function selectModel(modelId: string) {
    onSendCommand(`/gsd prefs --model ${modelId}`);
    showModelSelector = false;
    customModel = '';
  }

  function submitCustomModel() {
    const model = customModel.trim();
    if (model) {
      selectModel(model);
    }
  }

  function milestoneBadgeClass(status: string): string {
    return status === 'complete'
      ? 'badge-green'
      : status === 'active'
        ? 'badge-blue'
        : status === 'parked'
          ? 'badge-yellow'
          : 'badge-gray';
  }

  function sliceProgressPercent(slice: { doneTasks?: number | null; totalTasks?: number | null }): number {
    return slice.totalTasks ? Math.round(((slice.doneTasks ?? 0) / slice.totalTasks) * 100) : 0;
  }

  // Active-task labels are presentation data rather than canonical ids, so the
  // UI must give each rendered row its own stable occurrence key even when the
  // upstream list contains duplicate task labels.
  function activeTaskEntries(slice: { id: string; activeTasks?: string[] | null }, milestoneId: string) {
    return (slice.activeTasks ?? []).map((task, index) => ({
      key: `${milestoneId}/${slice.id}/${index}`,
      label: task,
    }));
  }
</script>

<div class="tab-scroll">
  {#if !dashboardState && !statusState}
    <div class="empty-state">
      <p>Waiting for data…</p>
    </div>
  {:else}
    {#if statusState}
      <div class="stats-scroll">
        <div class="stats-row">
          <div class="stat-box">
            <span class="stat-label">PROGRESS</span>
            <span class="stat-value">{`${statusState.summary.progressPercent ?? 0}%`}</span>
          </div>

          <div class="stat-box">
            <span class="stat-label">MILESTONES</span>
            <span class="stat-value">{`${statusState.summary.doneMilestones ?? 0}/${statusState.summary.totalMilestones ?? 0}`}</span>
          </div>

          <div class="stat-box">
            <span class="stat-label">SLICES</span>
            <span class="stat-value">{`${statusState.summary.doneSlices ?? 0}/${statusState.summary.totalSlices ?? 0}`}</span>
          </div>

          <div class="stat-box">
            <span class="stat-label">COST</span>
            <span class="stat-value">{formatCost(statusState.summary.cost ?? 0)}</span>
          </div>

          <div class="stat-box">
            <span class="stat-label">TOKENS</span>
            <span class="stat-value">{formatTokens(statusState.summary.tokens ?? 0)}</span>
          </div>
        </div>
      </div>
    {/if}

    {#if dashboardState}
      <section class="card">
        <h2 class="card-heading">Current State</h2>

        <dl class="info-grid">
          {#if dashboardState.phase}
            <dt>Phase</dt>
            <dd><span class="badge badge-blue">{dashboardState.phase}</span></dd>
          {/if}

          {#if dashboardState.activeMilestone}
            <dt>Milestone</dt>
            <dd class="truncate">{dashboardState.activeMilestone.title}</dd>
          {/if}

          {#if dashboardState.activeSlice}
            <dt>Slice</dt>
            <dd class="truncate">{dashboardState.activeSlice.title}</dd>
          {/if}

          {#if dashboardState.session?.model}
            <dt>Model</dt>
            <dd class="truncate model-cell">
              {dashboardState.session.model}
              <button
                type="button"
                class="model-change-btn"
                title="Change the active model"
                onclick={() => { showModelSelector = !showModelSelector; }}
              >
                ✎
              </button>
            </dd>
          {/if}

          {#if dashboardState.session?.messageCount != null}
            <dt>Messages</dt>
            <dd>{String(dashboardState.session.messageCount)}</dd>
          {/if}
        </dl>

        <!-- Inline model selector panel -->
        {#if showModelSelector}
          <div class="model-selector">
            <div class="model-selector-header">Select Model</div>
            <div class="model-presets">
              {#if availableModels().length > 0}
                {#each availableModels() as model (model.value)}
                  <button
                    type="button"
                    class="model-preset-btn"
                    class:active={dashboardState?.session?.model === model.value}
                    title={modelTitle(model)}
                    onclick={() => selectModel(model.value)}
                  >
                    {model.label}
                  </button>
                {/each}
              {:else}
                <p class="model-empty">No model list available yet. You can still enter a custom model ID below.</p>
              {/if}
            </div>
            <div class="model-custom-row">
              <input
                type="text"
                class="model-custom-input"
                placeholder="provider/model-id"
                value={customModel}
                oninput={(e) => { customModel = (e.target as HTMLInputElement).value; }}
                onkeydown={(e) => { if (e.key === 'Enter') submitCustomModel(); }}
              />
              <button
                type="button"
                class="btn btn-primary model-custom-submit"
                disabled={!customModel.trim()}
                title="Set custom model"
                onclick={submitCustomModel}
              >
                Set
              </button>
            </div>
          </div>
        {/if}

        <div class="badge-row">
          {#if dashboardState.autoModeRunning}
            {#if dashboardState.autoModePaused}
              <span class="badge badge-yellow">Auto (paused)</span>
            {:else}
              <span class="badge badge-green">Auto running</span>
            {/if}
          {/if}

          {#if dashboardState.session?.isStreaming}
            <span class="badge badge-blue">Streaming</span>
          {/if}
        </div>

        {#if dashboardState.next?.action}
          <p class="next-action">
            <span class="dim-label">Next: </span>
            {dashboardState.next.action}
          </p>
        {/if}

        {#if dashboardState.blockers && dashboardState.blockers.length > 0}
          <div class="blockers">
            <span class="dim-label">Blockers</span>
            <ul class="blocker-list">
              {#each dashboardState.blockers as blocker (blocker)}
                <li class="blocker-item">{blocker}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    {/if}

    {#if statusState && statusState.milestones && statusState.milestones.length > 0}
      <section class="card">
        <h2 class="card-heading">Milestones</h2>

        <div class="milestone-list">
          {#each statusState.milestones as milestone (milestone.id)}
            <div class="milestone-row">
              <div class="milestone-header">
                <span class="milestone-title">{milestone.title}</span>
                <span class={`badge ${milestoneBadgeClass(milestone.status)}`}>{milestone.status}</span>
              </div>

              {#if milestone.slices && milestone.slices.length > 0}
                <div class="slice-list">
                  {#each milestone.slices as slice (slice.id)}
                    <div class="slice-row">
                      <div class="slice-header">
                        <span class="slice-title">{slice.title}</span>
                        <span class="slice-tasks">{`${slice.doneTasks ?? 0}/${slice.totalTasks ?? 0}`}</span>
                      </div>

                      <div class="progress-track">
                        <div class="progress-fill" style:width={`${sliceProgressPercent(slice)}%`}></div>
                      </div>

                      {#if slice.activeTasks && slice.activeTasks.length > 0}
                        <ul class="active-tasks">
                          {#each activeTaskEntries(slice, milestone.id) as taskEntry (taskEntry.key)}
                            <li class="active-task">{taskEntry.label}</li>
                          {/each}
                        </ul>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <div class="action-row">
      <button type="button" class="btn btn-primary action-btn" title="Run autonomous mode — research, plan, execute, commit, repeat" onclick={() => onAction('auto')}>
        <span class="action-icon">▶</span> Auto
      </button>
      <button type="button" class="btn btn-accent action-btn" title="Execute one unit at a time, pause between each" onclick={() => onAction('next')}>
        <span class="action-icon">⏭</span> Next
      </button>
      <button type="button" class="btn btn-warning action-btn" title="Pause autonomous execution after current unit" onclick={() => onAction('pause')}>
        <span class="action-icon">⏸</span> Pause
      </button>
      <button type="button" class="btn btn-danger action-btn" title="Stop auto mode gracefully" onclick={() => onAction('stop')}>
        <span class="action-icon">⏹</span> Stop
      </button>
      <button type="button" class="btn btn-danger action-btn" title="Abort immediately without waiting for current unit" onclick={() => onAction('abort')}>
        <span class="action-icon">✕</span> Abort
      </button>
    </div>
  {/if}
</div>

<style>
  .tab-scroll {
    overflow-y: auto;
    flex: 1;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .action-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .action-icon {
    font-size: 0.7rem;
    margin-right: 0.15rem;
    opacity: 0.85;
  }

  .action-btn {
    flex: 1;
    font-size: 0.75rem;
    padding: 0.45rem 0;
    border-radius: 0.5rem;
    text-align: center;
    min-width: 4.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
  }

  .btn {
    border-radius: 0.5rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(30, 41, 59, 0.7);
    color: #e2e8f0;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
    overflow: hidden;
  }

  .btn:hover {
    background: rgba(51, 65, 85, 0.85);
    border-color: rgba(148, 163, 184, 0.3);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .btn:active {
    transform: translateY(0) scale(0.97);
    box-shadow: none;
    transition-duration: 0.05s;
  }

  .btn-primary {
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.85), rgba(29, 78, 216, 0.95));
    border-color: rgba(96, 165, 250, 0.35);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 1));
    border-color: rgba(96, 165, 250, 0.55);
    box-shadow: 0 2px 12px rgba(59, 130, 246, 0.35);
  }

  .btn-accent {
    background: rgba(30, 41, 59, 0.7);
    border-color: rgba(96, 165, 250, 0.25);
    color: #93c5fd;
  }

  .btn-accent:hover {
    background: rgba(37, 99, 235, 0.2);
    border-color: rgba(96, 165, 250, 0.45);
    box-shadow: 0 2px 10px rgba(59, 130, 246, 0.2);
  }

  .btn-warning {
    background: rgba(30, 41, 59, 0.7);
    border-color: rgba(250, 204, 21, 0.25);
    color: #fde68a;
  }

  .btn-warning:hover {
    background: rgba(161, 98, 7, 0.2);
    border-color: rgba(250, 204, 21, 0.45);
    box-shadow: 0 2px 10px rgba(250, 204, 21, 0.15);
  }

  .btn-danger {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.25);
    background: rgba(127, 29, 29, 0.2);
  }

  .btn-danger:hover {
    background: rgba(127, 29, 29, 0.4);
    border-color: rgba(248, 113, 113, 0.45);
    box-shadow: 0 2px 10px rgba(248, 113, 113, 0.2);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: #94a3b8;
    font-size: 0.85rem;
  }

  .empty-state p {
    margin: 0;
  }

  .stats-scroll {
    overflow-x: auto;
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .stats-scroll::-webkit-scrollbar {
    display: none;
  }

  .stats-row {
    display: flex;
    gap: 0.5rem;
    min-width: max-content;
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.6rem;
    padding: 0.5rem 0.75rem;
    min-width: 72px;
  }

  .stat-label {
    font-size: 0.65rem;
    color: #94a3b8;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .stat-value {
    font-size: 1rem;
    font-weight: 700;
    color: #e7eef7;
    white-space: nowrap;
  }

  .card {
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.75rem;
    padding: 0.75rem;
  }

  .card-heading {
    margin: 0 0 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .info-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.75rem;
    row-gap: 0.3rem;
    margin: 0 0 0.6rem;
  }

  .info-grid dt {
    font-size: 0.75rem;
    color: #94a3b8;
    white-space: nowrap;
    align-self: center;
  }

  .info-grid dd {
    font-size: 0.82rem;
    color: #e7eef7;
    margin: 0;
    align-self: center;
  }

  .truncate {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .badge-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .badge-row:empty {
    display: none;
  }

  .badge {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: 0.35rem;
    padding: 0.1rem 0.45rem;
    white-space: nowrap;
  }

  .badge-blue {
    background: rgba(59, 130, 246, 0.18);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge-green {
    background: rgba(74, 222, 128, 0.14);
    color: #86efac;
    border: 1px solid rgba(74, 222, 128, 0.28);
  }

  .badge-yellow {
    background: rgba(250, 204, 21, 0.14);
    color: #facc15;
    border: 1px solid rgba(250, 204, 21, 0.28);
  }

  .badge-gray {
    background: rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }

  .next-action {
    margin: 0 0 0.5rem;
    font-size: 0.78rem;
    color: #cbd5e1;
  }

  .dim-label {
    color: #94a3b8;
    font-size: 0.75rem;
  }

  .blockers {
    margin-top: 0.4rem;
  }

  .blocker-list {
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .blocker-item {
    font-size: 0.78rem;
    color: #fca5a5;
    background: rgba(248, 113, 113, 0.08);
    border-left: 2px solid rgba(248, 113, 113, 0.5);
    padding: 0.25rem 0.5rem;
    border-radius: 0 0.3rem 0.3rem 0;
  }

  .milestone-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .milestone-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .milestone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .milestone-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #e7eef7;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .slice-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-left: 0.75rem;
    border-left: 1px solid rgba(148, 163, 184, 0.12);
  }

  .slice-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .slice-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .slice-title {
    font-size: 0.78rem;
    color: #cbd5e1;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .slice-tasks {
    font-size: 0.72rem;
    color: #94a3b8;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .progress-track {
    height: 3px;
    background: rgba(148, 163, 184, 0.12);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .active-tasks {
    margin: 0.15rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .active-task {
    font-size: 0.72rem;
    color: #93c5fd;
    padding-left: 0.5rem;
    position: relative;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .active-task::before {
    content: '▸';
    position: absolute;
    left: 0;
    color: #3b82f6;
  }

  @media (min-width: 768px) {
    .action-row {
      flex-wrap: nowrap;
    }
  }

  @media (min-width: 768px) {
    .tab-scroll {
      padding: 1rem;
      gap: 1rem;
    }

    .stat-box {
      min-width: 88px;
      padding: 0.6rem 0.9rem;
    }

    .card {
      padding: 1rem;
    }
  }

  /* ── Model selector ── */

  .model-cell {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .model-change-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(30, 41, 59, 0.5);
    color: #94a3b8;
    font-size: 0.7rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .model-change-btn:hover {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(96, 165, 250, 0.4);
    color: #93c5fd;
  }

  .model-selector {
    background: rgba(9, 16, 25, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 0.6rem;
    padding: 0.65rem;
    margin-bottom: 0.5rem;
    animation: slide-open 0.15s ease;
  }

  @keyframes slide-open {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 300px; }
  }

  .model-selector-header {
    font-size: 0.72rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.5rem;
  }

  .model-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
  }

  .model-preset-btn {
    padding: 0.3rem 0.55rem;
    border-radius: 0.4rem;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(30, 41, 59, 0.6);
    color: #cbd5e1;
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .model-preset-btn:hover {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(96, 165, 250, 0.35);
    color: #93c5fd;
    transform: translateY(-1px);
  }

  .model-preset-btn:active {
    transform: translateY(0) scale(0.97);
  }

  .model-preset-btn.active {
    background: rgba(59, 130, 246, 0.25);
    border-color: rgba(96, 165, 250, 0.5);
    color: #93c5fd;
    font-weight: 600;
  }

  .model-custom-row {
    display: flex;
    gap: 0.35rem;
  }


  .model-empty {
    margin: 0;
    color: #94a3b8;
    font-size: 0.76rem;
    line-height: 1.4;
  }
  .model-custom-input {
    flex: 1;
    padding: 0.35rem 0.5rem;
    border-radius: 0.4rem;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.7);
    color: #e7eef7;
    font: inherit;
    font-size: 0.78rem;
    outline: none;
  }

  .model-custom-input::placeholder {
    color: #64748b;
  }

  .model-custom-input:focus {
    border-color: rgba(96, 165, 250, 0.45);
  }

  .model-custom-submit {
    padding: 0.35rem 0.6rem;
    font-size: 0.75rem;
  }
</style>