<script lang="ts">
  type CommandItem = {
    command: string;
    description: string;
    section: string;
  };

  interface Props {
    onSendCommand: (command: string) => void;
  }

  let { onSendCommand }: Props = $props();

  // Pending confirmation state for the command the user selected.
  let confirmItem = $state<CommandItem | null>(null);

  function requestSend(item: CommandItem) {
    confirmItem = item;
  }

  function confirmSend() {
    if (confirmItem) {
      onSendCommand(confirmItem.command);
      confirmItem = null;
    }
  }

  function cancelConfirm() {
    confirmItem = null;
  }

  // This catalog mirrors the command reference used by the GSD shell so the
  // web UI can quickly re-dispatch the same slash commands without manual typing.
  const COMMANDS: CommandItem[] = [
    { section: 'Session', command: '/gsd', description: 'Step mode — execute one unit at a time, pause between each' },
    { section: 'Session', command: '/gsd next', description: 'Explicit step mode (same as /gsd)' },
    { section: 'Session', command: '/gsd pause', description: 'Pause auto-mode (preserves state, /gsd auto to resume)' },
    { section: 'Session', command: '/gsd auto', description: 'Autonomous mode — research, plan, execute, commit, repeat' },
    { section: 'Session', command: '/gsd quick', description: 'Execute a quick task with GSD guarantees without full planning overhead' },
    { section: 'Session', command: '/gsd stop', description: 'Stop auto mode gracefully' },
    { section: 'Session', command: '/gsd steer', description: 'Hard-steer plan documents during execution' },
    { section: 'Session', command: '/gsd discuss', description: 'Discuss architecture and decisions' },
    { section: 'Session', command: '/gsd status', description: 'Progress dashboard' },
    { section: 'Session', command: '/gsd queue', description: 'Queue and reorder future milestones' },
    { section: 'Session', command: '/gsd capture', description: 'Fire-and-forget thought capture' },
    { section: 'Session', command: '/gsd triage', description: 'Manually trigger triage of pending captures' },
    { section: 'Session', command: '/gsd forensics', description: 'Post-mortem investigation of auto-mode failures' },
    { section: 'Session', command: '/gsd cleanup', description: 'Clean up GSD state files and stale worktrees' },
    { section: 'Session', command: '/gsd visualize', description: 'Open workflow visualizer for progress, deps, metrics, and timeline' },
    { section: 'Session', command: '/gsd export --html', description: 'Generate a self-contained HTML report' },
    { section: 'Session', command: '/gsd export --html --all', description: 'Generate retrospective reports for all milestones' },
    { section: 'Session', command: '/gsd update', description: 'Update GSD to the latest version in-session' },
    { section: 'Session', command: '/gsd knowledge', description: 'Add persistent project knowledge' },
    { section: 'Session', command: '/gsd help', description: 'Categorized command reference for all GSD subcommands' },
    { section: 'Config', command: '/gsd prefs', description: 'Model selection, timeouts, budget ceiling' },
    { section: 'Config', command: '/gsd mode', description: 'Switch workflow mode with coordinated defaults' },
    { section: 'Config', command: '/gsd doctor', description: 'Runtime health checks with auto-fix for common issues' },
    { section: 'Config', command: '/gsd skill-health', description: 'Skill lifecycle dashboard' },
    { section: 'Config', command: '/gsd skill-health <name>', description: 'Detailed view for a single skill' },
    { section: 'Config', command: '/gsd skill-health --declining', description: 'Show only skills flagged for declining performance' },
    { section: 'Config', command: '/gsd skill-health --stale N', description: 'Show skills unused for N+ days' },
    { section: 'Config', command: '/gsd hooks', description: 'Show configured post-unit and pre-dispatch hooks' },
    { section: 'Config', command: '/gsd run-hook', description: 'Manually trigger a specific hook' },
    { section: 'Config', command: '/gsd migrate', description: 'Migrate a v1 .planning directory to .gsd format' },
    { section: 'Parallel', command: '/gsd parallel start', description: 'Analyze eligibility, confirm, and start workers' },
    { section: 'Parallel', command: '/gsd parallel status', description: 'Show all workers with state, progress, and cost' },
    { section: 'Parallel', command: '/gsd parallel stop [MID]', description: 'Stop all workers or a specific milestone worker' },
    { section: 'Parallel', command: '/gsd parallel pause [MID]', description: 'Pause all workers or a specific one' },
    { section: 'Parallel', command: '/gsd parallel resume [MID]', description: 'Resume paused workers' },
    { section: 'Parallel', command: '/gsd parallel merge [MID]', description: 'Merge completed milestones back to main' },
  ];

  const SECTION_TITLES = ['Session', 'Config', 'Parallel'];
</script>

<!-- Confirmation overlay for command sends -->
{#if confirmItem}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="confirm-overlay" onclick={cancelConfirm}>
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="confirm-header">Confirm Command</div>
      <div class="confirm-body">
        <div class="confirm-command">{confirmItem.command}</div>
        <div class="confirm-desc">{confirmItem.description}</div>
      </div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-primary" onclick={confirmSend}>
          Run Command
        </button>
        <button type="button" class="btn btn-cancel" onclick={cancelConfirm}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<div class="commands-tab">
  <section class="intro-card">
    <div class="intro-title">Commands</div>
    <p class="intro-copy">Send a GSD slash command directly to the current instance. Every command prompts for confirmation before running.</p>
  </section>

  {#each SECTION_TITLES as section (section)}
    <section class="section-card">
      <div class="section-head">
        <h2>{section}</h2>
        <span class="count">{String(COMMANDS.filter((command) => command.section === section).length)}</span>
      </div>

      <div class="command-list">
        {#each COMMANDS.filter((command) => command.section === section) as item (item.command)}
          <div class="command-row">
            <div class="command-meta">
              <div class="command-text">
                {item.command}
              </div>
              <div class="command-desc">{item.description}</div>
            </div>
            <button
              type="button"
              class="send-btn"
              title="Send {item.command} to the instance"
              onclick={() => requestSend(item)}
            >
              Send
            </button>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  /* ── Confirmation overlay ── */
  .confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    animation: fade-in 0.15s ease;
  }

  .confirm-dialog {
    background: rgba(15, 23, 42, 0.96);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 0.85rem;
    padding: 1.25rem;
    width: min(90vw, 400px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    animation: slide-up 0.2s ease;
  }

  .confirm-header {
    font-size: 0.92rem;
    font-weight: 700;
    color: #e7eef7;
    margin-bottom: 0.75rem;
  }

  .confirm-body {
    margin-bottom: 1rem;
  }

  .confirm-command {
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    font-size: 0.88rem;
    color: #93c5fd;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 0.4rem;
    padding: 0.45rem 0.65rem;
    margin-bottom: 0.5rem;
  }

  .confirm-desc {
    font-size: 0.8rem;
    color: #94a3b8;
    line-height: 1.5;
  }

  .confirm-actions {
    display: flex;
    gap: 0.5rem;
  }

  .confirm-actions .btn {
    flex: 1;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .confirm-actions .btn-primary {
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.85), rgba(29, 78, 216, 0.95));
    border: 1px solid rgba(96, 165, 250, 0.4);
    color: #ffffff;
  }

  .confirm-actions .btn-primary:hover {
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 1));
    box-shadow: 0 2px 12px rgba(59, 130, 246, 0.35);
    transform: translateY(-1px);
  }

  .confirm-actions .btn-primary:active {
    transform: translateY(0) scale(0.97);
  }

  .confirm-actions .btn-cancel {
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.18);
    color: #94a3b8;
  }

  .confirm-actions .btn-cancel:hover {
    background: rgba(51, 65, 85, 0.85);
    color: #cbd5e1;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(12px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ── Main layout ── */
  .commands-tab {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .intro-card,
  .section-card {
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.75rem;
    padding: 0.75rem;
  }

  .intro-title {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #93c5fd;
    margin-bottom: 0.35rem;
  }

  .intro-copy {
    margin: 0;
    font-size: 0.82rem;
    color: #cbd5e1;
    line-height: 1.5;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }

  .section-head h2 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #e7eef7;
  }

  .count {
    display: inline-flex;
    align-items: center;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.14);
    color: #94a3b8;
    font-size: 0.72rem;
    font-weight: 500;
    line-height: 1.4;
  }

  .command-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .command-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.6rem;
    border-radius: 0.55rem;
    background: rgba(9, 16, 25, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.12);
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .command-row:hover {
    border-color: rgba(148, 163, 184, 0.22);
    background: rgba(15, 23, 42, 0.6);
  }

  .command-meta {
    min-width: 0;
  }

  .command-text {
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    font-size: 0.82rem;
    color: #93c5fd;
    margin-bottom: 0.15rem;
    word-break: break-word;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .command-desc {
    font-size: 0.75rem;
    color: #94a3b8;
    line-height: 1.4;
  }

  .send-btn {
    flex-shrink: 0;
    border-radius: 0.5rem;
    padding: 0.42rem 0.75rem;
    border: 1px solid rgba(96, 165, 250, 0.3);
    background: rgba(37, 99, 235, 0.15);
    color: #93c5fd;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .send-btn:hover {
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.85), rgba(29, 78, 216, 0.95));
    border-color: rgba(96, 165, 250, 0.5);
    color: #ffffff;
    transform: translateY(-1px);
    box-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
  }

  .send-btn:active {
    transform: translateY(0) scale(0.96);
    box-shadow: none;
    transition-duration: 0.05s;
  }

  @media (max-width: 720px) {
    .command-row {
      flex-direction: column;
      align-items: stretch;
    }

    .send-btn {
      width: 100%;
      text-align: center;
    }
  }
</style>