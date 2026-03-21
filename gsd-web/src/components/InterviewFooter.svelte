<script lang="ts">
  import type { WebInterviewQuestion, WebPendingInterview } from '@gsd/web-protocol';
  import { readTextControlValue } from '../utils';

  interface Props {
    interview: WebPendingInterview;
    onSubmitQuestionBody: (body: Record<string, unknown>) => void;
  }

  const OTHER_OPTION_LABEL = 'None of the above';

  let { interview, onSubmitQuestionBody }: Props = $props();

  let activeIndex = $state(0);
  let reviewMode = $state(false);
  let singleAnswers = $state<Record<string, string>>({});
  let multiAnswers = $state<Record<string, string[]>>({});
  let notesById = $state<Record<string, string>>({});

  // This component intentionally keeps all interview answers client-side until
  // the final review submit so the browser can mirror the TUI's edit/review loop.
  $effect(() => {
    interview.id;
    activeIndex = 0;
    reviewMode = false;
    singleAnswers = {};
    multiAnswers = {};
    notesById = {};
  });

  function questions() {
    return interview.questions;
  }

  function currentQuestion(): WebInterviewQuestion | null {
    return questions()[activeIndex] ?? null;
  }

  function isAnswered(question: WebInterviewQuestion): boolean {
    if (question.allowMultiple) {
      return (multiAnswers[question.id] ?? []).length > 0;
    }
    return Boolean(singleAnswers[question.id]);
  }

  function answeredCount(): number {
    return questions().filter(isAnswered).length;
  }

  function setSingle(questionId: string, value: string) {
    singleAnswers = { ...singleAnswers, [questionId]: value };
  }

  function toggleMulti(questionId: string, value: string) {
    const next = new Set(multiAnswers[questionId] ?? []);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    multiAnswers = { ...multiAnswers, [questionId]: Array.from(next) };
  }

  function updateNotes(questionId: string, event: Event) {
    notesById = { ...notesById, [questionId]: readTextControlValue(event) };
  }

  function answerSummary(question: WebInterviewQuestion): string {
    if (question.allowMultiple) {
      const selected = multiAnswers[question.id] ?? [];
      return selected.length > 0 ? selected.join(', ') : 'No selection';
    }
    return singleAnswers[question.id] ?? 'No selection';
  }

  function canContinue(question: WebInterviewQuestion | null): boolean {
    return question !== null && isAnswered(question);
  }

  function nextStep() {
    const question = currentQuestion();
    if (!canContinue(question)) return;
    if (activeIndex >= questions().length - 1) {
      reviewMode = true;
      return;
    }
    activeIndex += 1;
  }

  function previousStep() {
    if (reviewMode) {
      reviewMode = false;
      activeIndex = Math.max(questions().length - 1, 0);
      return;
    }
    activeIndex = Math.max(activeIndex - 1, 0);
  }

  function submitInterview() {
    const answers = Object.fromEntries(questions().map((question) => [
      question.id,
      {
        selected: question.allowMultiple ? (multiAnswers[question.id] ?? []) : (singleAnswers[question.id] ?? ''),
        notes: notesById[question.id] ?? '',
      },
    ]));
    onSubmitQuestionBody({ answers });
  }
</script>

{#if reviewMode}
  <div class="interview-shell">
    <div class="question-title">{interview.reviewHeadline ?? 'Review your answers'}</div>
    {#if interview.progress}
      <div class="interview-progress">{interview.progress}</div>
    {/if}
    <div class="review-list">
      {#each questions() as question (question.id)}
        <div class="review-card">
          <div class="review-header">
            <span class="review-tab">{question.header}</span>
            <span class="review-answer">{answerSummary(question)}</span>
          </div>
          <div class="review-question">{question.question}</div>
          {#if notesById[question.id]}
            <div class="review-notes">Note: {notesById[question.id]}</div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="question-actions">
      <button type="button" class="btn" onclick={previousStep}>Back</button>
      <button type="button" class="btn btn-primary" onclick={submitInterview}>Submit all</button>
      <button type="button" class="btn btn-cancel" onclick={() => onSubmitQuestionBody({ cancelled: true })}>
        {interview.exitLabel ?? 'Cancel'}
      </button>
    </div>
  </div>
{:else if currentQuestion()}
  <div class="interview-shell">
    <div class="question-title">{interview.title}</div>
    <div class="interview-meta">
      {#if interview.progress}
        <span>{interview.progress}</span>
      {/if}
      <span>{answeredCount()}/{questions().length} answered</span>
    </div>

    <div class="tab-strip">
      {#each questions() as question, index (question.id)}
        <button
          type="button"
          class="tab-pill"
          class:is-active={index === activeIndex}
          class:is-complete={isAnswered(question)}
          onclick={() => { activeIndex = index; }}
        >
          {question.header}
        </button>
      {/each}
    </div>

    <div class="question-message">{currentQuestion()?.question ?? ''}</div>

    <div class="option-list">
      {#each currentQuestion()?.options ?? [] as opt (opt.label)}
        <label class="option-row">
          <input
            type={currentQuestion()?.allowMultiple ? 'checkbox' : 'radio'}
            class:option-checkbox={Boolean(currentQuestion()?.allowMultiple)}
            class:option-radio={!currentQuestion()?.allowMultiple}
            name={currentQuestion()?.id}
            checked={currentQuestion()?.allowMultiple ? (multiAnswers[currentQuestion()?.id ?? ''] ?? []).includes(opt.label) : singleAnswers[currentQuestion()?.id ?? ''] === opt.label}
            onchange={() => {
              const question = currentQuestion();
              if (!question) return;
              if (question.allowMultiple) toggleMulti(question.id, opt.label);
              else setSingle(question.id, opt.label);
            }}
          />
          <span class="option-label-text">{opt.label}</span>
          {#if opt.description}
            <span class="option-description">{opt.description}</span>
          {/if}
        </label>
      {/each}

      {#if !currentQuestion()?.allowMultiple}
        <label class="option-row option-row-muted">
          <input
            type="radio"
            class="option-radio"
            name={currentQuestion()?.id}
            checked={singleAnswers[currentQuestion()?.id ?? ''] === OTHER_OPTION_LABEL}
            onchange={() => {
              const question = currentQuestion();
              if (!question) return;
              setSingle(question.id, OTHER_OPTION_LABEL);
            }}
          />
          <span class="option-label-text">{OTHER_OPTION_LABEL}</span>
          <span class="option-description">Use notes to describe a different preference.</span>
        </label>
      {/if}
    </div>

    <div class="notes-row">
      <label class="notes-label" for={`interview-note-${currentQuestion()?.id ?? 'current'}`}>Notes (optional)</label>
      <textarea
        id={`interview-note-${currentQuestion()?.id ?? 'current'}`}
        class="notes-input"
        value={notesById[currentQuestion()?.id ?? ''] ?? ''}
        placeholder="Add context before the final review…"
        oninput={(event) => {
          const question = currentQuestion();
          if (!question) return;
          updateNotes(question.id, event);
        }}
      ></textarea>
    </div>

    <div class="question-actions">
      <button type="button" class="btn" disabled={activeIndex === 0} onclick={previousStep}>Back</button>
      <button type="button" class="btn btn-primary" disabled={!canContinue(currentQuestion())} onclick={nextStep}>
        {activeIndex >= questions().length - 1 ? 'Review' : 'Next'}
      </button>
      <button type="button" class="btn btn-cancel" onclick={() => onSubmitQuestionBody({ cancelled: true })}>
        {interview.exitLabel ?? 'Cancel'}
      </button>
    </div>
  </div>
{/if}

<style>
  .interview-shell {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .interview-meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    color: #94a3b8;
    font-size: 0.72rem;
  }

  .interview-progress {
    color: #94a3b8;
    font-size: 0.74rem;
  }

  .tab-strip {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .tab-pill {
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.55);
    color: #cbd5e1;
    border-radius: 999px;
    padding: 0.28rem 0.55rem;
    font: inherit;
    font-size: 0.74rem;
    cursor: pointer;
  }

  .tab-pill.is-active {
    border-color: rgba(96, 165, 250, 0.38);
    color: #dbeafe;
    background: rgba(37, 99, 235, 0.22);
  }

  .tab-pill.is-complete {
    box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.28);
  }

  .review-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .review-card {
    border: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(15, 23, 42, 0.48);
    border-radius: 0.5rem;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .review-header {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: baseline;
  }

  .review-tab {
    color: #93c5fd;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .review-answer {
    color: #e7eef7;
    font-size: 0.78rem;
  }

  .review-question {
    color: #cbd5e1;
    font-size: 0.78rem;
  }

  .review-notes {
    color: #94a3b8;
    font-size: 0.74rem;
  }

  .option-row-muted {
    border-top: 1px dashed rgba(148, 163, 184, 0.16);
    padding-top: 0.5rem;
  }
</style>