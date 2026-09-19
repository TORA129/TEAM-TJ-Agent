import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createCopywriterState,
  createJobState,
  createReviewState,
  StateTransitionRejectedError,
  transitionCopywriter,
  transitionJob,
  transitionReview,
  type AuthorizationBinding,
  type CopywriterEvent,
  type CopywriterMachineState,
  type JobEvent,
  type JobMachineState,
  type ReviewEvent,
  type ReviewMachineState,
  type TransitionMetadata,
} from '../domain/state-machines';

const fixedDate = new Date('2026-01-01T00:00:00.000Z');

function metadata(inputVersion: number, attemptCount = 0, errorCode?: string): TransitionMetadata {
  return {
    inputVersion,
    attemptCount,
    sourceRecordId: `source-transition-${inputVersion}-${attemptCount}`,
    ...(errorCode ? { errorCode } : {}),
    occurredAt: fixedDate,
  };
}

function copyTransition(
  state: CopywriterMachineState,
  event: CopywriterEvent,
  attemptCount = 0,
  errorCode?: string,
) {
  return transitionCopywriter(state, event, metadata(state.inputVersion, attemptCount, errorCode));
}

function reviewTransition(state: ReviewMachineState, event: ReviewEvent) {
  return transitionReview(state, event, metadata(state.inputVersion));
}

function jobTransition(state: JobMachineState, event: JobEvent, errorCode?: string) {
  return transitionJob(state, event, metadata(state.inputVersion, state.attemptCount, errorCode));
}

function completeCopywriterDraft(): CopywriterMachineState {
  let state = createCopywriterState();
  state = copyTransition(state, { type: 'BRIEF_COMPLETE' }).state;
  state = copyTransition(state, { type: 'START_DRAFT_GENERATION' }).state;
  state = copyTransition(state, { type: 'DRAFT_GENERATED' }).state;
  state = copyTransition(state, {
    type: 'DRAFT_VALIDATED',
    rulesPassed: true,
    sourcesComplete: true,
  }).state;
  return state;
}

function completeReviewResult(): ReviewMachineState {
  let state = createReviewState();
  state = reviewTransition(state, {
    type: 'SUBMIT_NOTE_URL',
    exactNoteUrl: 'https://www.xiaohongshu.com/explore/abc',
  }).state;
  state = reviewTransition(state, {
    type: 'CONFIRM_AUTHORIZATION',
    authorization: authorization('https://www.xiaohongshu.com/explore/abc'),
  }).state;
  state = reviewTransition(state, { type: 'START_OPENCLI_FETCH' }).state;
  state = reviewTransition(state, { type: 'OPENCLI_CONTENT_READY' }).state;
  state = reviewTransition(state, { type: 'CONTENT_TO_METRICS' }).state;
  state = reviewTransition(state, { type: 'UPDATE_METRICS', metricCount: 1 }).state;
  state = reviewTransition(state, { type: 'START_EVALUATION' }).state;
  state = reviewTransition(state, { type: 'EVALUATION_READY' }).state;
  return state;
}

function authorization(exactNoteUrl: string): AuthorizationBinding {
  return {
    exactNoteUrl,
    normalizedNoteUrl: exactNoteUrl,
    toolId: 'opencli-authorized',
    purpose: 'review the supplied note',
    accountMode: 'PUBLIC_ACCESS',
    confirmedAt: fixedDate,
  };
}

function expectRejected(action: () => unknown, code: StateTransitionRejectedError['code']) {
  expect(action).toThrowError(StateTransitionRejectedError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('Copywriter state machine', () => {
  it('keeps an incomplete brief in the three-answer gate until all answers exist', () => {
    let state = createCopywriterState();
    state = copyTransition(state, { type: 'BRIEF_INCOMPLETE', missingFieldCount: 2 }).state;
    state = copyTransition(state, { type: 'CREATE_QUESTION_SET', questionCount: 3 }).state;
    state = copyTransition(state, {
      type: 'ANSWER_QUESTIONS',
      answers: ['first answer', null, null],
    }).state;

    expect(state.status).toBe('WAITING_FOR_ANSWERS');
    expect(() => copyTransition(state, { type: 'START_DRAFT_GENERATION' })).toThrowError(
      StateTransitionRejectedError,
    );

    state = copyTransition(state, {
      type: 'ANSWER_QUESTIONS',
      answers: ['first answer', 'second answer', 'third answer'],
    }).state;
    expect(state.status).toBe('READY_TO_GENERATE');
    expect(copyTransition(state, { type: 'START_DRAFT_GENERATION' }).state.status).toBe(
      'DRAFT_GENERATING',
    );
  });

  it('requires compliance before cover generation and confirmation before export', () => {
    let state = completeCopywriterDraft();
    expect(() => copyTransition(state, { type: 'START_COVER_GENERATION' })).toThrowError(
      StateTransitionRejectedError,
    );

    state = copyTransition(state, { type: 'REQUEST_COMPLIANCE_CHECK' }).state;
    state = copyTransition(state, {
      type: 'COMPLIANCE_RESULT',
      passed: true,
      claimsComplete: true,
    }).state;
    state = copyTransition(state, { type: 'START_COVER_GENERATION' }).state;
    state = copyTransition(state, { type: 'COVER_RESULT', validThreeToFourRatio: true }).state;
    state = copyTransition(state, { type: 'COVER_READY_FOR_REVIEW' }).state;
    expect(() =>
      copyTransition(state, { type: 'EXPORT_CONFIRMED_VERSION', version: 1 }),
    ).toThrowError(StateTransitionRejectedError);

    state = copyTransition(state, { type: 'CONFIRM_VERSION', version: 1 }).state;
    state = copyTransition(state, { type: 'EXPORT_CONFIRMED_VERSION', version: 1 }).state;
    expect(state.status).toBe('EXPORTED');
  });

  it('invalidates confirmation and downstream readiness after an input version changes', () => {
    let state = completeCopywriterDraft();
    state = copyTransition(state, { type: 'REQUEST_COMPLIANCE_CHECK' }).state;
    state = copyTransition(state, {
      type: 'COMPLIANCE_RESULT',
      passed: true,
      claimsComplete: true,
    }).state;
    state = copyTransition(state, { type: 'START_COVER_GENERATION' }).state;
    state = copyTransition(state, { type: 'COVER_RESULT', validThreeToFourRatio: true }).state;
    state = copyTransition(state, { type: 'COVER_READY_FOR_REVIEW' }).state;
    state = copyTransition(state, { type: 'CONFIRM_VERSION', version: 1 }).state;
    state = copyTransition(state, { type: 'EXPORT_CONFIRMED_VERSION', version: 1 }).state;

    state = transitionCopywriter(
      state,
      { type: 'INPUT_CHANGED', newInputVersion: 2 },
      metadata(2),
    ).state;
    expect(state).toMatchObject({
      status: 'DRAFT_EDITING',
      inputVersion: 2,
      compliancePassed: false,
      coverAvailable: false,
      confirmedVersion: undefined,
      exportedVersion: undefined,
    });
  });

  it('rejects client attempts to assign a state instead of emitting a domain event', () => {
    const event = {
      type: 'BRIEF_COMPLETE',
      status: 'EXPORTED',
    } as unknown as CopywriterEvent;
    expectRejected(() => copyTransition(createCopywriterState(), event), 'REQUEST_INVALID');
  });
});

describe('Review state machine', () => {
  it('never permits OpenCLI access without exact authorization and supports manual fallback', () => {
    let state = createReviewState(1, 'https://www.xiaohongshu.com/explore/abc');
    expect(() => reviewTransition(state, { type: 'START_OPENCLI_FETCH' })).toThrowError(
      StateTransitionRejectedError,
    );

    state = reviewTransition(state, { type: 'SELECT_MANUAL_INPUT' }).state;
    state = reviewTransition(state, { type: 'SAVE_MANUAL_CONTENT' }).state;
    expect(state.status).toBe('CONTENT_READY');

    state = createReviewState();
    state = reviewTransition(state, {
      type: 'SUBMIT_NOTE_URL',
      exactNoteUrl: 'https://www.xiaohongshu.com/explore/abc',
    }).state;
    expectRejected(
      () =>
        reviewTransition(state, {
          type: 'CONFIRM_AUTHORIZATION',
          authorization: authorization('https://www.xiaohongshu.com/explore/other'),
        }),
      'AUTHORIZATION_REQUIRED',
    );
  });

  it('requires evaluated content and a passed insight compliance check before confirmation', () => {
    let state = completeReviewResult();
    state = reviewTransition(state, { type: 'START_INSIGHT_CHECK' }).state;
    state = reviewTransition(state, { type: 'INSIGHT_COMPLIANCE_FAILED' }).state;
    expect(state.status).toBe('INSIGHT_BLOCKED');
    expect(() =>
      reviewTransition(state, { type: 'CONFIRM_REVIEW_VERSION', version: 1 }),
    ).toThrowError(StateTransitionRejectedError);

    state = reviewTransition(state, { type: 'INSIGHT_BLOCKED_RESOLVED' }).state;
    state = reviewTransition(state, { type: 'CONFIRM_REVIEW_VERSION', version: 1 }).state;
    state = reviewTransition(state, { type: 'EXPORT_REVIEW_VERSION', version: 1 }).state;
    expect(state.status).toBe('EXPORTED');
  });

  it('records immutable transition metadata through the hook', () => {
    const transitions: unknown[] = [];
    const state = createReviewState();
    const result = transitionReview(
      state,
      { type: 'SELECT_MANUAL_INPUT' },
      metadata(1, 2, 'MODEL_RATE_LIMITED'),
      (transition) => transitions.push(transition),
    );

    expect(result.transition).toMatchObject({
      from: 'REVIEW_CREATED',
      to: 'MANUAL_INPUT',
      inputVersion: 1,
      attemptCount: 2,
      redactedErrorCode: 'MODEL_RATE_LIMITED',
      sourceRecordId: 'source-transition-1-2',
      occurredAt: fixedDate,
    });
    expect(transitions).toHaveLength(1);
  });
});

describe('Job state machine', () => {
  it('moves retryable failures back through the queue and requires manual fallback at exhaustion', () => {
    let state = createJobState('COPY_GENERATION', 1, 2);
    state = jobTransition(state, { type: 'START' }).state;
    state = jobTransition(state, {
      type: 'FAIL',
      retryable: true,
      errorCode: 'MODEL_RATE_LIMITED',
    }).state;
    expect(state).toMatchObject({ status: 'RETRYABLE_FAILURE', attemptCount: 1 });
    state = jobTransition(state, { type: 'REQUEUE' }).state;
    state = jobTransition(state, { type: 'START' }).state;
    state = transitionJob(
      state,
      { type: 'FAIL', retryable: true, errorCode: 'api_key=do-not-leak' },
      metadata(1, state.attemptCount),
    ).state;

    expect(state).toMatchObject({
      status: 'TERMINAL_FAILURE',
      attemptCount: 2,
      manualFallbackRequired: true,
      errorCode: 'REDACTED_ERROR',
    });
    expect(() => jobTransition(state, { type: 'START' })).toThrowError(
      StateTransitionRejectedError,
    );
  });

  it('records the redacted error code and source on a failure transition', () => {
    let state = createJobState('OPENCLI_FETCH', 3, 1);
    state = jobTransition(state, { type: 'START' }).state;
    const result = transitionJob(
      state,
      { type: 'FAIL', retryable: false, errorCode: 'secret_token_value' },
      metadata(3, 1),
    );
    expect(result.transition.redactedErrorCode).toBe('REDACTED_ERROR');
    expect(result.transition.sourceRecordId).toBe('source-transition-3-1');
  });

  it('keeps unknown client status values from becoming legal transitions', () => {
    const arbitraryStatus = fc.stringMatching(/^[A-Z_]{1,20}$/);
    fc.assert(
      fc.property(arbitraryStatus, (status) => {
        const event = { type: 'START', status } as unknown as JobEvent;
        expect(() =>
          transitionJob(createJobState('FILE_PARSE', 1, 1), event, metadata(1)),
        ).toThrowError(StateTransitionRejectedError);
      }),
      { numRuns: 100, seed: 3202 },
    );
  });
});
