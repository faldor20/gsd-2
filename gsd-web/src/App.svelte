<script lang="ts">
  import {
    WEB_UI_SECTION_NAMES,
    type ManagedInstanceSummary,
    type OverviewState,
    type WebComposerState,
    type WebDashboardState,
    type WebEditedFileSummary,
    type WebPendingInterview,
    type WebLogEntry,
    type WebMessageSummary,
    type WebPendingQuestion,
    type WebStatusState,
    type WebUiState,
  } from '@gsd/web-protocol';

  import { ManagerClient, createEmptyOverviewState } from './manager-client';
  import { instanceStatusLabel } from './utils';
  import ActivityTab from './components/ActivityTab.svelte';
  import ChatFooter from './components/ChatFooter.svelte';
  import DashboardTab from './components/DashboardTab.svelte';
  import DetailsTab from './components/DetailsTab.svelte';
  import CommandsTab from './components/CommandsTab.svelte';
  import InstancePicker from './components/InstancePicker.svelte';
  import MessagesTab from './components/MessagesTab.svelte';

  type TabId = 'dashboard' | 'commands' | 'messages' | 'activity' | 'details';

  const TAB_LABELS: { id: TabId; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'commands', label: 'Commands' },
    { id: 'messages', label: 'Messages' },
    { id: 'activity', label: 'Activity' },
    { id: 'details', label: 'Details' },
  ];

  function findInstanceSummary(
    instances: ManagedInstanceSummary[],
    instanceId: string | null,
  ): ManagedInstanceSummary | null {
    if (!instanceId) return null;
    return instances.find((instance) => instance.instanceId === instanceId) ?? null;
  }

  // Keep transport, selection, and derived view state together so the tab
  // components remain presentational and the converted UI matches the Ripple app.
  let connected = $state(false);
  let commandError = $state<string | null>(null);
  let overview = $state<OverviewState>(createEmptyOverviewState());
  let selectedInstanceId = $state<string | null>(null);
  let detailState = $state<Partial<WebUiState> | null>(null);
  let promptText = $state('');
  let activeTab = $state<TabId>('dashboard');

  const client = new ManagerClient();

  let selectedSummary = $derived(findInstanceSummary(overview.instances, selectedInstanceId));
  let instances = $derived(overview.instances);
  let dashboardState = $derived<WebDashboardState | null>(detailState?.dashboard ?? null);
  let composerState = $derived<WebComposerState | null>(detailState?.composer ?? null);
  let pendingQuestion = $derived<WebPendingQuestion | null>(detailState?.questions?.pending ?? null);
  let pendingInterview = $derived<WebPendingInterview | null>(detailState?.questions?.interview ?? null);
  let recentMessages = $derived<WebMessageSummary[]>(detailState?.recentMessages ?? []);
  let recentFiles = $derived<WebEditedFileSummary[]>(detailState?.recentFiles ?? []);
  let logEntries = $derived<WebLogEntry[]>(detailState?.logs ?? []);
  let statusState = $derived<WebStatusState | null>(detailState?.status ?? null);
  let footerDisabled = $derived(!selectedSummary?.connected || composerState?.disabled === true);

  $effect(() => {
    client.onConnectionChange = (nextConnected) => {
      connected = nextConnected;
      if (nextConnected) commandError = null;
    };

    client.onError = (message) => {
      commandError = message;
    };

    client.onCommandResult = (result) => {
      if (result.ok) {
        commandError = null;
        return;
      }

      commandError = result.error ?? 'Command failed.';
    };

    client.onOverviewUpdate = () => {
      overview = client.overviewState ?? createEmptyOverviewState();
    };

    client.onInstanceUpdate = () => {
      detailState = client.instanceState;
    };

    client.onBootstrapSelection = (instanceId) => {
      if (!selectedInstanceId) selectInstance(instanceId);
    };

    client.connect();

    return () => {
      client.disconnect();
    };
  });

  function selectInstance(instanceId: string | null) {
    selectedInstanceId = instanceId;
    detailState = null;
    promptText = '';
    commandError = null;
    activeTab = 'dashboard';
    client.selectInstance(instanceId, instanceId ? [...WEB_UI_SECTION_NAMES] : undefined);
  }

  function sendAction(action: 'auto' | 'next' | 'pause' | 'stop' | 'abort') {
    if (!selectedInstanceId) return;
    client.sendAction(selectedInstanceId, action);
  }

  function sendCommand(commandText: string) {
    if (!selectedInstanceId) return;

    // Slash commands are delivered through the same session prompt pipe as
    // ordinary chat input so they reach the selected instance with no extra transport logic.
    client.sendPrompt(selectedInstanceId, commandText, 'prompt');
  }

  function sendPrompt() {
    if (!selectedInstanceId) return;
    const message = promptText.trim();
    if (!message) return;
    client.sendPrompt(selectedInstanceId, message, 'prompt');
    promptText = '';
  }

  function sendSteer() {
    if (!selectedInstanceId) return;
    const message = promptText.trim();
    if (!message) return;
    client.sendPrompt(selectedInstanceId, message, 'steer');
    promptText = '';
  }

  function submitQuestionBody(body: Record<string, unknown>) {
    const pendingId = pendingQuestion?.id ?? pendingInterview?.id;
    if (!selectedInstanceId || !pendingId) return;
    client.sendQuestionResponse(selectedInstanceId, { id: pendingId, ...body });
  }

  function submitQuestionText() {
    // Retained as an internal helper for text/editor questions handled inside ChatFooter.
    // ChatFooter calls onSubmitQuestionBody with { value, note } directly for text inputs.
  }
</script>

<div class="shell">
  <header class="header">
    {#if selectedInstanceId}
      <button type="button" class="back-btn" onclick={() => selectInstance(null)} title="Back to instance list">
        ←
      </button>
      <div class="header-title">
        <strong>{selectedSummary?.displayName || selectedSummary?.projectName || 'Instance'}</strong>
        {#if selectedSummary}
          <span class="header-meta">{selectedSummary.projectName}</span>
        {/if}
      </div>
    {:else}
      <div class="header-title">
        <strong>GSD Manager</strong>
        <span class="header-meta">{`${overview.counts.connected}/${overview.counts.total} connected`}</span>
      </div>
    {/if}

    <div class="header-right">
      {#if selectedSummary}
        <span class="header-badge">{instanceStatusLabel(selectedSummary)}</span>
      {/if}
      <span class="status-dot" class:dot-ok={connected} class:dot-err={!connected}></span>
    </div>
  </header>

  {#if commandError}
    <div class="banner">{commandError}</div>
  {/if}

  {#if !selectedInstanceId}
    <InstancePicker {instances} onSelect={selectInstance} />
  {:else}
    <nav class="tab-bar">
      {#each TAB_LABELS as tab (tab.id)}
        <button
          type="button"
          class="tab-btn"
          class:tab-active={activeTab === tab.id}
          onclick={() => {
            activeTab = tab.id;
          }}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    <div class="tab-content">
      {#if !detailState}
        <div class="empty-state">
          <p>Loading instance data…</p>
        </div>
      {:else if activeTab === 'dashboard'}
        <DashboardTab {dashboardState} {statusState} onAction={sendAction} onSendCommand={sendCommand} />
      {:else if activeTab === 'commands'}
        <CommandsTab onSendCommand={sendCommand} />
      {:else if activeTab === 'messages'}
        <MessagesTab {recentMessages} />
      {:else if activeTab === 'activity'}
        <ActivityTab {recentFiles} {logEntries} />
      {:else if activeTab === 'details'}
        <DetailsTab {statusState} {dashboardState} />
      {/if}
    </div>

    <ChatFooter
      {promptText}
      {composerState}
      {pendingQuestion}
      {pendingInterview}
      disabled={footerDisabled}
      onPromptTextChange={(value) => {
        promptText = value;
      }}
      onSendPrompt={sendPrompt}
      onSendSteer={sendSteer}
      onSubmitQuestionBody={submitQuestionBody}
    />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    background: #091019;
    color: #e7eef7;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .shell {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 32%),
      radial-gradient(circle at top right, rgba(34, 197, 94, 0.09), transparent 26%),
      #091019;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 44px;
    min-height: 44px;
    padding: 0 0.75rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(9, 16, 25, 0.88);
    backdrop-filter: blur(12px);
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(30, 41, 59, 0.6);
    color: #cbd5e1;
    font-size: 1rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .back-btn:hover {
    background: rgba(51, 65, 85, 0.8);
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .back-btn:active {
    transform: scale(0.95);
    box-shadow: none;
  }

  .header-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .header-title strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.92rem;
  }

  .header-meta {
    color: #94a3b8;
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .header-badge {
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.8);
    color: #cbd5e1;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .dot-ok {
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
  }

  .dot-err {
    background: #f87171;
    box-shadow: 0 0 6px rgba(248, 113, 113, 0.5);
  }

  .banner {
    margin: 0.5rem 0.75rem 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(248, 113, 113, 0.28);
    background: rgba(127, 29, 29, 0.35);
    color: #fecaca;
    font-size: 0.85rem;
  }

  .tab-bar {
    display: flex;
    height: 38px;
    min-height: 38px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(9, 16, 25, 0.7);
    padding: 0 0.5rem;
    gap: 0.25rem;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: #94a3b8;
    font-size: 0.8rem;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .tab-btn:hover {
    color: #cbd5e1;
  }

  .tab-btn.tab-active {
    color: #93c5fd;
    border-bottom-color: #3b82f6;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 8rem;
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .empty-state p {
    margin: 0;
  }

  @media (min-width: 768px) {
    .header {
      height: 48px;
      min-height: 48px;
      padding: 0 1rem;
    }

    .header-title strong {
      font-size: 1rem;
    }

    .tab-bar {
      height: 42px;
      min-height: 42px;
      padding: 0 1rem;
    }

    .tab-btn {
      flex: none;
      padding: 0 1.25rem;
      font-size: 0.85rem;
    }
  }
</style>