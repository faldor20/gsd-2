<script lang="ts">
  import type { WebComposerState, WebPendingInterview, WebPendingQuestion } from '@gsd/web-protocol';
  import InterviewFooter from './InterviewFooter.svelte';
  import { readTextControlValue } from '../utils';

  interface Props {
    promptText: string;
    composerState: WebComposerState | null;
    pendingQuestion: WebPendingQuestion | null;
    pendingInterview: WebPendingInterview | null;
    disabled: boolean;
    onPromptTextChange: (value: string) => void;
    onSendPrompt: () => void;
    onSendSteer: () => void;
    onSubmitQuestionBody: (body: Record<string, unknown>) => void;
  }

  let {
    promptText,
    composerState,
    pendingQuestion,
    pendingInterview,
    disabled,
    onPromptTextChange,
    onSendPrompt,
    onSendSteer,
    onSubmitQuestionBody,
  }: Props = $props();

  let inputText = $state('');
  let singleSelected = $state<string | null>(null);
  let multiSelected = $state<Set<string>>(new Set());
  let noteText = $state('');

  // Reset local state whenever the active question changes so the footer never
  // leaks stale answers from one request into the next.
  $effect(() => {
    const question = pendingQuestion;
    if (!question) {
      inputText = '';
      singleSelected = null;
      multiSelected = new Set();
      noteText = '';
      return;
    }

    inputText = question.method === 'input' || question.method === 'editor'
      ? (question.prefill ?? '')
      : '';
    singleSelected = null;
    multiSelected = new Set();
    noteText = '';
  });

  function hasPendingQuestion() { return pendingQuestion != null || pendingInterview != null; }
  function isConfirmMode() { return pendingQuestion?.method === 'confirm'; }
  function isSingleSelectMode() { return pendingQuestion?.method === 'select' && !pendingQuestion.allowMultiple; }
  function isMultiSelectMode() { return pendingQuestion?.method === 'select' && pendingQuestion.allowMultiple; }
  function isTextMode() { return pendingQuestion?.method === 'input' || pendingQuestion?.method === 'editor'; }

  function submitSingleSelect() {
    if (!singleSelected) return;
    onSubmitQuestionBody({ value: singleSelected, note: noteText || undefined });
  }

  function toggleMulti(label: string) {
    const next = new Set(multiSelected);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    multiSelected = next;
  }

  function submitMultiSelect() {
    onSubmitQuestionBody({ values: Array.from(multiSelected), note: noteText || undefined });
  }

  function submitInput() {
    onSubmitQuestionBody({ value: inputText, note: noteText || undefined });
  }

  function cancelQuestion() {
    onSubmitQuestionBody({ cancelled: true });
  }

  function handleInputKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitInput();
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSendPrompt();
    }
  }

  function handlePromptInput(event: Event) {
    onPromptTextChange(readTextControlValue(event));
  }
</script>

<div class="footer">
  <div class="question-area" class:is-hidden={!hasPendingQuestion()}>
    {#if pendingInterview}
      <InterviewFooter interview={pendingInterview} onSubmitQuestionBody={onSubmitQuestionBody} />
    {:else}
    <div class="question-title">{pendingQuestion?.title ?? ''}</div>

    <div class="question-message" class:is-hidden={!pendingQuestion?.message}>
      {pendingQuestion?.message ?? ''}
    </div>

    <div class="question-mode" class:is-hidden={!isConfirmMode()}>
      <div class="question-actions">
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => onSubmitQuestionBody({ confirmed: true, note: noteText || undefined })}
          title="Confirm this action"
        >
          Confirm
        </button>
        <button type="button" class="btn btn-cancel" onclick={cancelQuestion} title="Cancel and dismiss this question">
          Cancel
        </button>
      </div>
    </div>

    <div class="question-mode" class:is-hidden={!isSingleSelectMode()}>
      <div class="option-list">
        {#each pendingQuestion?.options ?? [] as opt (opt.label)}
          <label class="option-row">
            <input
              type="radio"
              class="option-radio"
              name="single-q-option"
              value={opt.label}
              checked={singleSelected === opt.label}
              onchange={() => { singleSelected = opt.label; }}
            />
            <span class="option-label-text">{opt.label}</span>
            {#if opt.description}
              <span class="option-description">{opt.description}</span>
            {/if}
          </label>
        {/each}
      </div>
      <div class="notes-row">
        <label class="notes-label" for="single-q-note">Notes (optional)</label>
        <textarea
          id="single-q-note"
          class="notes-input"
          value={noteText}
          placeholder="Add any notes for the agent…"
          oninput={(event) => { noteText = readTextControlValue(event); }}
        ></textarea>
      </div>
      <div class="question-actions">
        <button
          type="button"
          class="btn btn-primary"
          disabled={!singleSelected}
          onclick={submitSingleSelect}
          title="Submit selected option"
        >
          Submit
        </button>
        <button type="button" class="btn btn-cancel" onclick={cancelQuestion} title="Cancel and dismiss this question">
          Cancel
        </button>
      </div>
    </div>

    <div class="question-mode" class:is-hidden={!isMultiSelectMode()}>
      <div class="option-list">
        {#each pendingQuestion?.options ?? [] as opt (opt.label)}
          <label class="option-row">
            <input
              type="checkbox"
              class="option-checkbox"
              checked={multiSelected.has(opt.label)}
              onchange={() => toggleMulti(opt.label)}
            />
            <span class="option-label-text">{opt.label}</span>
            {#if opt.description}
              <span class="option-description">{opt.description}</span>
            {/if}
          </label>
        {/each}
      </div>
      <div class="notes-row">
        <label class="notes-label" for="multi-q-note">Notes (optional)</label>
        <textarea
          id="multi-q-note"
          class="notes-input"
          value={noteText}
          placeholder="Add any notes for the agent…"
          oninput={(event) => { noteText = readTextControlValue(event); }}
        ></textarea>
      </div>
      <div class="question-actions">
        <button
          type="button"
          class="btn btn-primary"
          onclick={submitMultiSelect}
          title="Submit selected options"
        >
          Submit
        </button>
        <button type="button" class="btn btn-cancel" onclick={cancelQuestion} title="Cancel and dismiss this question">
          Cancel
        </button>
      </div>
    </div>

    <div class="question-mode" class:is-hidden={!isTextMode()}>
      <textarea
        class="chat-input"
        value={inputText}
        placeholder={pendingQuestion?.placeholder ?? ''}
        oninput={(event) => { inputText = readTextControlValue(event); }}
        onkeydown={handleInputKeyDown}
      ></textarea>
      <div class="notes-row">
        <label class="notes-label" for="text-q-note">Notes (optional)</label>
        <textarea
          id="text-q-note"
          class="notes-input"
          value={noteText}
          placeholder="Add any notes for the agent…"
          oninput={(event) => { noteText = readTextControlValue(event); }}
        ></textarea>
      </div>
      <div class="question-actions">
        <button type="button" class="btn btn-primary" onclick={submitInput} title="Submit your response">
          Submit
        </button>
        <button type="button" class="btn btn-cancel" onclick={cancelQuestion} title="Cancel and dismiss this question">
          Cancel
        </button>
      </div>
    </div>
    {/if}
  </div>

  <div class="chat-row" class:is-hidden={hasPendingQuestion()}>
    <textarea
      class="chat-input"
      value={promptText}
      placeholder={composerState?.placeholder ?? 'Send a prompt'}
      disabled={disabled}
      oninput={handlePromptInput}
      onkeydown={handlePromptKeyDown}
    ></textarea>
    <div class="send-buttons">
      <button
        type="button"
        class="btn btn-primary send-btn"
        disabled={disabled}
        onclick={onSendPrompt}
        title="Send prompt to the agent"
      >
        Send
      </button>
      <button type="button" class="btn send-btn" disabled={disabled} onclick={onSendSteer} title="Steer the agent while it's running">
        Steer
      </button>
    </div>
  </div>
</div>

<style>
  .is-hidden {
    display: none !important;
  }

  .footer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(9, 16, 25, 0.92);
    backdrop-filter: blur(12px);
    padding: 0.5rem 0.75rem;
    flex-shrink: 0;
  }

  .chat-row {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
  }

  .chat-input {
    flex: 1;
    min-height: 2rem;
    max-height: 6rem;
    resize: none;
    padding: 0.35rem 0.5rem;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 0.5rem;
    color: #e7eef7;
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.4;
    outline: none;
    overflow-y: auto;
  }

  .chat-input::placeholder {
    color: #64748b;
  }

  .chat-input:focus {
    border-color: rgba(96, 165, 250, 0.45);
  }

  .chat-input:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .send-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .send-btn {
    white-space: nowrap;
  }

  .question-area {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .question-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: #e7eef7;
  }

  .question-message {
    font-size: 0.78rem;
    color: #94a3b8;
    line-height: 1.4;
  }

  .question-mode {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .option-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .option-row {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.45rem;
    padding: 0.35rem 0.45rem;
    border-radius: 0.4rem;
    cursor: pointer;
    transition: background 0.12s;
  }

  .option-row:hover {
    background: rgba(96, 165, 250, 0.07);
  }

  .option-row > input {
    order: -1;
  }

  .option-radio,
  .option-checkbox {
    margin-top: 0.18rem;
    accent-color: #60a5fa;
    flex-shrink: 0;
  }

  .option-label-text {
    font-size: 0.82rem;
    color: #e7eef7;
    line-height: 1.35;
  }

  .option-description {
    flex-basis: 100%;
    padding-left: 1.4rem;
    font-size: 0.74rem;
    color: #64748b;
    line-height: 1.35;
  }

  .notes-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .notes-label {
    font-size: 0.72rem;
    color: #64748b;
    font-weight: 500;
  }

  .notes-input {
    width: 100%;
    min-height: 1.8rem;
    max-height: 4rem;
    resize: none;
    padding: 0.3rem 0.45rem;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 0.4rem;
    color: #e7eef7;
    font: inherit;
    font-size: 0.78rem;
    line-height: 1.4;
    outline: none;
    overflow-y: auto;
  }

  .notes-input::placeholder {
    color: #475569;
  }

  .notes-input:focus {
    border-color: rgba(96, 165, 250, 0.35);
  }

  .question-actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .btn {
    border-radius: 0.5rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(30, 41, 59, 0.7);
    color: #e2e8f0;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    background: rgba(51, 65, 85, 0.85);
  }

  .btn:active:not(:disabled) {
    transform: scale(0.97);
    box-shadow: none;
  }

  .btn-primary {
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.9), rgba(29, 78, 216, 0.9));
    border-color: rgba(96, 165, 250, 0.35);
  }

  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95));
    border-color: rgba(96, 165, 250, 0.55);
    box-shadow: 0 2px 10px rgba(37, 99, 235, 0.35);
  }

  .btn-cancel {
    color: #94a3b8;
  }

  .btn-cancel:hover:not(:disabled) {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.3);
    background: rgba(127, 29, 29, 0.2);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .chat-row {
      flex-direction: column;
      align-items: stretch;
    }

    .send-buttons {
      flex-direction: row;
      justify-content: stretch;
    }

    .send-btn {
      flex: 1;
    }

    .question-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .question-actions > .btn {
      width: 100%;
    }
  }
</style>
