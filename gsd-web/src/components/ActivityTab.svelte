<script lang="ts">
  import type { WebEditedFileSummary, WebLogEntry } from '@gsd/web-protocol';
  import { formatRelativeTime } from '../utils';

  interface Props {
    recentFiles: WebEditedFileSummary[];
    logEntries: WebLogEntry[];
  }

  let { recentFiles, logEntries }: Props = $props();

  function levelClass(level: WebLogEntry['level']): string {
    switch (level) {
      case 'info':
        return 'level-info';
      case 'warning':
        return 'level-warning';
      case 'error':
        return 'level-error';
      case 'success':
        return 'level-success';
      default:
        return 'level-info';
    }
  }
</script>

<div class="tab-scroll">
  <section class="section">
    <div class="section-head">
      <h3>Files</h3>
      <span class="count">{String(recentFiles.length)}</span>
    </div>

    {#if recentFiles.length === 0}
      <p class="empty">No file changes recorded</p>
    {:else}
      <ul class="file-list">
        {#each recentFiles as file (file.path)}
          <li class="file-row">
            <span class="file-path">{file.path}</span>
            <span class="diff-stats">+{file.addedLines} / -{file.removedLines}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="section-gap"></div>

  <section class="section">
    <div class="section-head">
      <h3>Logs</h3>
      <span class="count">{String(logEntries.length)}</span>
    </div>

    {#if logEntries.length === 0}
      <p class="empty">No logs captured</p>
    {:else}
      <div class="log-list">
        {#each logEntries as entry (entry.id)}
          <div class={`log-card ${levelClass(entry.level)}`}>
            <div class="log-header">
              <span class="log-scope">{entry.scope}</span>
              <span class="log-time">{formatRelativeTime(entry.timestamp)}</span>
            </div>
            <div class="log-body">{entry.message}</div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .tab-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
  }

  .section-gap {
    height: 1rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .section-head h3 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
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

  .empty {
    margin: 0;
    padding: 0.4rem 0;
    font-size: 0.82rem;
    color: #94a3b8;
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    border-radius: 0.4rem;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    font-size: 0.82rem;
    min-width: 0;
  }

  .file-path {
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    color: #93c5fd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .diff-stats {
    flex-shrink: 0;
    color: #94a3b8;
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .log-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .log-card {
    padding: 0.5rem;
    border-radius: 0.4rem;
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-left-width: 3px;
    font-size: 0.82rem;
  }

  .level-info { border-left-color: #93c5fd; }
  .level-warning { border-left-color: #facc15; }
  .level-error { border-left-color: #f87171; }
  .level-success { border-left-color: #4ade80; }

  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .log-scope {
    font-weight: 600;
    font-size: 0.78rem;
    color: #cbd5e1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .log-time {
    flex-shrink: 0;
    font-size: 0.72rem;
    color: #64748b;
  }

  .log-body {
    color: #94a3b8;
    font-size: 0.78rem;
    line-height: 1.5;
    word-break: break-word;
  }
</style>