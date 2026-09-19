import type { AccountMode, JobKind } from './persistence/models';

export type CopywriterStatus =
  | 'BRIEF_EDITING'
  | 'NEEDS_CLARIFICATION'
  | 'WAITING_FOR_ANSWERS'
  | 'READY_TO_GENERATE'
  | 'DRAFT_GENERATING'
  | 'DRAFT_VALIDATION'
  | 'DRAFT_READY'
  | 'NEEDS_OPERATOR_CONFIRMATION'
  | 'DRAFT_EDITING'
  | 'COMPLIANCE_CHECK_REQUIRED'
  | 'COMPLIANCE_PASSED'
  | 'COMPLIANCE_ISSUES'
  | 'COVER_GENERATING'
  | 'COVER_READY'
  | 'COVER_FAILED'
  | 'COVER_REPLACEMENT'
  | 'REVIEW_PENDING'
  | 'REVIEW_CONFIRMED'
  | 'EXPORTED';

export type ReviewStatus =
  | 'REVIEW_CREATED'
  | 'AUTH_REQUIRED'
  | 'AUTH_CONFIRMED'
  | 'FETCHING_OPENCLI'
  | 'CONTENT_READY'
  | 'ACCESS_FAILED'
  | 'MANUAL_INPUT'
  | 'METRICS_PARTIAL'
  | 'EVALUATING'
  | 'RESULT_READY'
  | 'RESULT_EDITING'
  | 'INSIGHT_CHECK'
  | 'INSIGHT_SAVED'
  | 'INSIGHT_BLOCKED'
  | 'REVIEW_CONFIRMED'
  | 'EXPORTED';

export type JobStateStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILURE'
  | 'TERMINAL_FAILURE';

export type StateMachineErrorCode =
  | 'REQUEST_INVALID'
  | 'VALIDATION_FAILED'
  | 'QUESTION_SET_INVALID'
  | 'AUTHORIZATION_REQUIRED'
  | 'COMPLIANCE_BLOCKED'
  | 'CONFIRMATION_REQUIRED'
  | 'RETRY_EXHAUSTED';

export interface AuthorizationBinding {
  readonly exactNoteUrl: string;
  readonly normalizedNoteUrl: string;
  readonly toolId: string;
  readonly purpose: string;
  readonly accountMode: AccountMode;
  readonly confirmedAt: Date;
  readonly expiresAt?: Date;
}

/**
 * Metadata is supplied by a trusted server-side caller. It is intentionally
 * not part of a client event and is persisted with every transition.
 */
export interface TransitionMetadata {
  readonly inputVersion: number;
  readonly attemptCount: number;
  readonly sourceRecordId: string;
  readonly errorCode?: string;
  readonly maxAttempts?: number;
  readonly occurredAt?: Date;
}

export interface TransitionRecord<S extends string, E extends string> {
  readonly from: S;
  readonly to: S;
  readonly event: E;
  readonly inputVersion: number;
  readonly attemptCount: number;
  readonly redactedErrorCode?: string;
  readonly sourceRecordId: string;
  readonly occurredAt: Date;
}

export type TransitionHook<S extends string, E extends string> = (
  transition: TransitionRecord<S, E>,
) => void;

export interface TransitionResult<TState, S extends string, E extends string> {
  readonly state: TState;
  readonly transition: TransitionRecord<S, E>;
}

export class StateTransitionRejectedError extends Error {
  readonly name = 'StateTransitionRejectedError';

  constructor(
    readonly code: StateMachineErrorCode,
    readonly reason: string,
    readonly from?: string,
    readonly event?: string,
  ) {
    super(reason);
  }
}

export interface CopywriterMachineState {
  readonly status: CopywriterStatus;
  readonly inputVersion: number;
  readonly questionSetRequired: boolean;
  readonly answeredCount: number;
  readonly compliancePassed: boolean;
  readonly coverAvailable: boolean;
  readonly confirmedVersion?: number;
  readonly exportedVersion?: number;
}

export type ThreeAnswers = readonly [string | null, string | null, string | null];

export type CopywriterEvent =
  | { readonly type: 'BRIEF_INCOMPLETE'; readonly missingFieldCount: number }
  | { readonly type: 'CREATE_QUESTION_SET'; readonly questionCount: number }
  | { readonly type: 'ANSWER_QUESTIONS'; readonly answers: ThreeAnswers }
  | { readonly type: 'DECLINE_QUESTIONS' }
  | { readonly type: 'BRIEF_COMPLETE' }
  | { readonly type: 'START_DRAFT_GENERATION' }
  | { readonly type: 'DRAFT_GENERATED' }
  | {
      readonly type: 'DRAFT_VALIDATED';
      readonly rulesPassed: boolean;
      readonly sourcesComplete: boolean;
    }
  | { readonly type: 'START_DRAFT_EDIT' }
  | { readonly type: 'SAVE_DRAFT_EDIT' }
  | { readonly type: 'REQUEST_COMPLIANCE_CHECK' }
  | {
      readonly type: 'COMPLIANCE_RESULT';
      readonly passed: boolean;
      readonly claimsComplete: boolean;
    }
  | { readonly type: 'START_COVER_GENERATION' }
  | { readonly type: 'COVER_RESULT'; readonly validThreeToFourRatio: boolean }
  | { readonly type: 'RETRY_COVER_GENERATION' }
  | { readonly type: 'UPLOAD_REPLACEMENT_COVER' }
  | { readonly type: 'COVER_READY_FOR_REVIEW' }
  | { readonly type: 'CONFIRM_VERSION'; readonly version: number }
  | { readonly type: 'EXPORT_CONFIRMED_VERSION'; readonly version: number }
  | { readonly type: 'INPUT_CHANGED'; readonly newInputVersion: number };

export function createCopywriterState(inputVersion = 1): CopywriterMachineState {
  assertPositiveInteger(inputVersion, 'inputVersion');
  return {
    status: 'BRIEF_EDITING',
    inputVersion,
    questionSetRequired: false,
    answeredCount: 0,
    compliancePassed: false,
    coverAvailable: false,
  };
}

export function transitionCopywriter(
  current: CopywriterMachineState,
  event: CopywriterEvent,
  metadata: TransitionMetadata,
  onTransition?: TransitionHook<CopywriterStatus, CopywriterEvent['type']>,
): TransitionResult<CopywriterMachineState, CopywriterStatus, CopywriterEvent['type']> {
  assertTrustedEvent(event);
  assertMetadata(metadata);
  assertInputVersion(current, event, metadata);

  let next: CopywriterMachineState;
  switch (event.type) {
    case 'BRIEF_INCOMPLETE':
      if (current.status !== 'BRIEF_EDITING' || event.missingFieldCount < 1) {
        reject('VALIDATION_FAILED', 'Only an incomplete brief can enter clarification.');
      }
      next = {
        ...current,
        status: 'NEEDS_CLARIFICATION',
        questionSetRequired: true,
        answeredCount: 0,
      };
      break;
    case 'CREATE_QUESTION_SET':
      if (current.status !== 'NEEDS_CLARIFICATION' || event.questionCount !== 3) {
        reject('QUESTION_SET_INVALID', 'A Question_Set must contain exactly three questions.');
      }
      next = { ...current, status: 'WAITING_FOR_ANSWERS', answeredCount: 0 };
      break;
    case 'ANSWER_QUESTIONS': {
      if (current.status !== 'WAITING_FOR_ANSWERS') {
        reject('QUESTION_SET_INVALID', 'Answers can only be submitted for an open Question_Set.');
      }
      const answeredCount = countAnswers(event.answers);
      next = {
        ...current,
        status: answeredCount === 3 ? 'READY_TO_GENERATE' : 'WAITING_FOR_ANSWERS',
        answeredCount,
      };
      break;
    }
    case 'DECLINE_QUESTIONS':
      if (current.status !== 'WAITING_FOR_ANSWERS') {
        reject('QUESTION_SET_INVALID', 'Only an open Question_Set can be declined.');
      }
      next = { ...current, status: 'BRIEF_EDITING', questionSetRequired: true, answeredCount: 0 };
      break;
    case 'BRIEF_COMPLETE':
      if (current.status !== 'BRIEF_EDITING') {
        reject('VALIDATION_FAILED', 'Only the brief editing state can be completed.');
      }
      next = {
        ...current,
        status: 'READY_TO_GENERATE',
        questionSetRequired: false,
        answeredCount: 0,
      };
      break;
    case 'START_DRAFT_GENERATION':
      if (current.status !== 'READY_TO_GENERATE') {
        reject('REQUEST_INVALID', 'The current state is not ready for draft generation.');
      }
      if (current.questionSetRequired && current.answeredCount !== 3) {
        reject('QUESTION_SET_INVALID', 'A final draft requires all three Question_Set answers.');
      }
      next = { ...current, status: 'DRAFT_GENERATING' };
      break;
    case 'DRAFT_GENERATED':
      requireStatus(current, 'DRAFT_GENERATING');
      next = { ...current, status: 'DRAFT_VALIDATION' };
      break;
    case 'DRAFT_VALIDATED':
      requireStatus(current, 'DRAFT_VALIDATION');
      if (!event.rulesPassed || !event.sourcesComplete) {
        next = { ...current, status: 'NEEDS_OPERATOR_CONFIRMATION' };
      } else {
        next = { ...current, status: 'DRAFT_READY' };
      }
      break;
    case 'START_DRAFT_EDIT':
      if (
        current.status !== 'NEEDS_OPERATOR_CONFIRMATION' &&
        current.status !== 'COMPLIANCE_ISSUES'
      ) {
        reject('REQUEST_INVALID', 'Only a draft needing review can enter draft editing.');
      }
      next = {
        ...current,
        status: 'DRAFT_EDITING',
        compliancePassed: false,
        coverAvailable: false,
      };
      break;
    case 'SAVE_DRAFT_EDIT':
      requireStatus(current, 'DRAFT_EDITING');
      next = {
        ...current,
        status: 'COMPLIANCE_CHECK_REQUIRED',
        compliancePassed: false,
        coverAvailable: false,
      };
      break;
    case 'REQUEST_COMPLIANCE_CHECK':
      if (current.status !== 'DRAFT_READY' && current.status !== 'DRAFT_EDITING') {
        reject('REQUEST_INVALID', 'Only a ready or edited draft can request compliance review.');
      }
      next = { ...current, status: 'COMPLIANCE_CHECK_REQUIRED', compliancePassed: false };
      break;
    case 'COMPLIANCE_RESULT':
      requireStatus(current, 'COMPLIANCE_CHECK_REQUIRED');
      if (!event.passed || !event.claimsComplete) {
        next = {
          ...current,
          status: 'COMPLIANCE_ISSUES',
          compliancePassed: false,
          coverAvailable: false,
        };
      } else {
        next = { ...current, status: 'COMPLIANCE_PASSED', compliancePassed: true };
      }
      break;
    case 'START_COVER_GENERATION':
      requireStatus(current, 'COMPLIANCE_PASSED');
      if (!current.compliancePassed) {
        reject('COMPLIANCE_BLOCKED', 'A cover cannot be generated before compliance passes.');
      }
      next = { ...current, status: 'COVER_GENERATING' };
      break;
    case 'COVER_RESULT':
      requireStatus(current, 'COVER_GENERATING');
      next = event.validThreeToFourRatio
        ? { ...current, status: 'COVER_READY', coverAvailable: true }
        : { ...current, status: 'COVER_FAILED', coverAvailable: false };
      break;
    case 'RETRY_COVER_GENERATION':
      requireStatus(current, 'COVER_FAILED');
      assertRetryAvailable(metadata);
      next = { ...current, status: 'COVER_GENERATING' };
      break;
    case 'UPLOAD_REPLACEMENT_COVER':
      requireStatus(current, 'COVER_FAILED');
      next = { ...current, status: 'COVER_REPLACEMENT', coverAvailable: true };
      break;
    case 'COVER_READY_FOR_REVIEW':
      if (current.status !== 'COVER_READY' && current.status !== 'COVER_REPLACEMENT') {
        reject('REQUEST_INVALID', 'Only an available cover can enter review pending.');
      }
      next = { ...current, status: 'REVIEW_PENDING', coverAvailable: true };
      break;
    case 'CONFIRM_VERSION':
      requireStatus(current, 'REVIEW_PENDING');
      if (event.version !== current.inputVersion) {
        reject('CONFIRMATION_REQUIRED', 'Confirmation must target the current input version.');
      }
      next = { ...current, status: 'REVIEW_CONFIRMED', confirmedVersion: event.version };
      break;
    case 'EXPORT_CONFIRMED_VERSION':
      requireStatus(current, 'REVIEW_CONFIRMED');
      if (
        current.confirmedVersion !== current.inputVersion ||
        event.version !== current.inputVersion
      ) {
        reject('CONFIRMATION_REQUIRED', 'Export requires confirmation of the current version.');
      }
      next = { ...current, status: 'EXPORTED', exportedVersion: event.version };
      break;
    case 'INPUT_CHANGED':
      if (event.newInputVersion <= current.inputVersion) {
        reject('VALIDATION_FAILED', 'An input change must create a newer version.');
      }
      if (metadata.inputVersion !== event.newInputVersion) {
        reject('VALIDATION_FAILED', 'Transition metadata must reference the new input version.');
      }
      next = {
        ...current,
        status: 'DRAFT_EDITING',
        inputVersion: event.newInputVersion,
        compliancePassed: false,
        coverAvailable: false,
        confirmedVersion: undefined,
        exportedVersion: undefined,
      };
      break;
    default:
      return assertNever(event);
  }

  return commitTransition(current, next, event.type, metadata, onTransition);
}

export interface ReviewMachineState {
  readonly status: ReviewStatus;
  readonly inputVersion: number;
  readonly noteUrl?: string;
  readonly authorization?: AuthorizationBinding;
  readonly contentReady: boolean;
  readonly metricCount: number;
  readonly insightCompliancePassed: boolean;
  readonly confirmedVersion?: number;
  readonly exportedVersion?: number;
}

export type ReviewEvent =
  | { readonly type: 'SUBMIT_NOTE_URL'; readonly exactNoteUrl: string }
  | { readonly type: 'SELECT_MANUAL_INPUT' }
  | { readonly type: 'CONFIRM_AUTHORIZATION'; readonly authorization: AuthorizationBinding }
  | { readonly type: 'START_OPENCLI_FETCH' }
  | { readonly type: 'OPENCLI_CONTENT_READY' }
  | { readonly type: 'OPENCLI_ACCESS_FAILED' }
  | { readonly type: 'SAVE_MANUAL_CONTENT' }
  | { readonly type: 'CONTENT_TO_METRICS' }
  | { readonly type: 'UPDATE_METRICS'; readonly metricCount: number }
  | { readonly type: 'START_EVALUATION' }
  | { readonly type: 'EVALUATION_READY' }
  | { readonly type: 'EDIT_RESULT' }
  | { readonly type: 'SAVE_RESULT_EDIT' }
  | { readonly type: 'START_INSIGHT_CHECK' }
  | { readonly type: 'INSIGHT_COMPLIANCE_PASSED' }
  | { readonly type: 'INSIGHT_COMPLIANCE_FAILED' }
  | { readonly type: 'INSIGHT_BLOCKED_RESOLVED' }
  | { readonly type: 'CONFIRM_REVIEW_VERSION'; readonly version: number }
  | { readonly type: 'EXPORT_REVIEW_VERSION'; readonly version: number }
  | { readonly type: 'AUTHORIZATION_CONTEXT_CHANGED'; readonly exactNoteUrl: string; readonly toolId?: string; readonly purpose?: string; readonly accountMode?: AccountMode };

export function createReviewState(inputVersion = 1, noteUrl?: string): ReviewMachineState {
  assertPositiveInteger(inputVersion, 'inputVersion');
  return {
    status: noteUrl ? 'AUTH_REQUIRED' : 'REVIEW_CREATED',
    inputVersion,
    noteUrl,
    contentReady: false,
    metricCount: 0,
    insightCompliancePassed: false,
  };
}

export function transitionReview(
  current: ReviewMachineState,
  event: ReviewEvent,
  metadata: TransitionMetadata,
  onTransition?: TransitionHook<ReviewStatus, ReviewEvent['type']>,
): TransitionResult<ReviewMachineState, ReviewStatus, ReviewEvent['type']> {
  assertTrustedEvent(event);
  assertMetadata(metadata);
  assertInputVersion(current, event, metadata);

  let next: ReviewMachineState;
  switch (event.type) {
    case 'SUBMIT_NOTE_URL':
      requireStatus(current, 'REVIEW_CREATED');
      assertRequiredText(event.exactNoteUrl, 'exactNoteUrl');
      next = { ...current, status: 'AUTH_REQUIRED', noteUrl: event.exactNoteUrl };
      break;
    case 'SELECT_MANUAL_INPUT':
      if (
        current.status !== 'REVIEW_CREATED' &&
        current.status !== 'AUTH_REQUIRED' &&
        current.status !== 'ACCESS_FAILED'
      ) {
        reject('REQUEST_INVALID', 'Manual content is only a fallback before content is ready.');
      }
      next = { ...current, status: 'MANUAL_INPUT', authorization: undefined };
      break;
    case 'CONFIRM_AUTHORIZATION':
      requireStatus(current, 'AUTH_REQUIRED');
      if (!current.noteUrl || event.authorization.exactNoteUrl !== current.noteUrl) {
        reject(
          'AUTHORIZATION_REQUIRED',
          'Authorization must bind to the exact submitted Note_URL.',
        );
      }
      assertAuthorization(event.authorization);
      next = { ...current, status: 'AUTH_CONFIRMED', authorization: event.authorization };
      break;
    case 'START_OPENCLI_FETCH':
      requireStatus(current, 'AUTH_CONFIRMED');
      if (!current.authorization || !isAuthorizationValid(current.authorization, current.noteUrl)) {
        reject(
          'AUTHORIZATION_REQUIRED',
          'A valid exact authorization is required before OpenCLI access.',
        );
      }
      next = { ...current, status: 'FETCHING_OPENCLI' };
      break;
    case 'OPENCLI_CONTENT_READY':
      requireStatus(current, 'FETCHING_OPENCLI');
      next = { ...current, status: 'CONTENT_READY', contentReady: true };
      break;
    case 'OPENCLI_ACCESS_FAILED':
      requireStatus(current, 'FETCHING_OPENCLI');
      next = { ...current, status: 'ACCESS_FAILED', contentReady: false };
      break;
    case 'SAVE_MANUAL_CONTENT':
      requireStatus(current, 'MANUAL_INPUT');
      next = { ...current, status: 'CONTENT_READY', contentReady: true };
      break;
    case 'CONTENT_TO_METRICS':
      requireStatus(current, 'CONTENT_READY');
      next = { ...current, status: 'METRICS_PARTIAL' };
      break;
    case 'UPDATE_METRICS':
      if (current.status !== 'CONTENT_READY' && current.status !== 'METRICS_PARTIAL') {
        reject('REQUEST_INVALID', 'Metrics can only be edited after content is available.');
      }
      if (!Number.isSafeInteger(event.metricCount) || event.metricCount < 0) {
        reject('VALIDATION_FAILED', 'metricCount must be a non-negative integer.');
      }
      next = { ...current, status: 'METRICS_PARTIAL', metricCount: event.metricCount };
      break;
    case 'START_EVALUATION':
      requireStatus(current, 'METRICS_PARTIAL');
      next = { ...current, status: 'EVALUATING' };
      break;
    case 'EVALUATION_READY':
      requireStatus(current, 'EVALUATING');
      next = { ...current, status: 'RESULT_READY' };
      break;
    case 'EDIT_RESULT':
      requireStatus(current, 'RESULT_READY');
      next = { ...current, status: 'RESULT_EDITING' };
      break;
    case 'SAVE_RESULT_EDIT':
      requireStatus(current, 'RESULT_EDITING');
      next = { ...current, status: 'EVALUATING' };
      break;
    case 'START_INSIGHT_CHECK':
      requireStatus(current, 'RESULT_READY');
      next = { ...current, status: 'INSIGHT_CHECK', insightCompliancePassed: false };
      break;
    case 'INSIGHT_COMPLIANCE_PASSED':
      requireStatus(current, 'INSIGHT_CHECK');
      next = { ...current, status: 'INSIGHT_SAVED', insightCompliancePassed: true };
      break;
    case 'INSIGHT_COMPLIANCE_FAILED':
      requireStatus(current, 'INSIGHT_CHECK');
      next = { ...current, status: 'INSIGHT_BLOCKED', insightCompliancePassed: false };
      break;
    case 'INSIGHT_BLOCKED_RESOLVED':
      requireStatus(current, 'INSIGHT_BLOCKED');
      next = { ...current, status: 'RESULT_READY', insightCompliancePassed: false };
      break;
    case 'CONFIRM_REVIEW_VERSION':
      if (current.status !== 'RESULT_READY' && current.status !== 'INSIGHT_SAVED') {
        reject('CONFIRMATION_REQUIRED', 'Only a completed review result can be confirmed.');
      }
      if (event.version !== current.inputVersion) {
        reject('CONFIRMATION_REQUIRED', 'Confirmation must target the current review version.');
      }
      next = { ...current, status: 'REVIEW_CONFIRMED', confirmedVersion: event.version };
      break;
    case 'EXPORT_REVIEW_VERSION':
      requireStatus(current, 'REVIEW_CONFIRMED');
      if (
        current.confirmedVersion !== current.inputVersion ||
        event.version !== current.inputVersion
      ) {
        reject(
          'CONFIRMATION_REQUIRED',
          'Export requires confirmation of the current review version.',
        );
      }
      next = { ...current, status: 'EXPORTED', exportedVersion: event.version };
      break;
    case 'AUTHORIZATION_CONTEXT_CHANGED':
      if (
        current.status !== 'AUTH_CONFIRMED' &&
        current.status !== 'ACCESS_FAILED' &&
        current.status !== 'FETCHING_OPENCLI'
      ) {
        reject('REQUEST_INVALID', 'Only an existing authorization context can be invalidated.');
      }
      assertRequiredText(event.exactNoteUrl, 'exactNoteUrl');
      if (metadata.inputVersion <= current.inputVersion) {
        reject(
          'VALIDATION_FAILED',
          'A changed authorization context requires a newer input version.',
        );
      }
      const contextChanged = current.authorization && (
        current.authorization.exactNoteUrl !== event.exactNoteUrl ||
        (event.toolId !== undefined && current.authorization.toolId !== event.toolId) ||
        (event.purpose !== undefined && current.authorization.purpose !== event.purpose) ||
        (event.accountMode !== undefined && current.authorization.accountMode !== event.accountMode)
      );
      if (!contextChanged) {
        reject('VALIDATION_FAILED', 'Authorization context did not change.');
      }
      next = {
        ...current,
        status: 'AUTH_REQUIRED',
        inputVersion: metadata.inputVersion,
        noteUrl: event.exactNoteUrl,
        authorization: undefined,
        contentReady: false,
        metricCount: 0,
        insightCompliancePassed: false,
        confirmedVersion: undefined,
        exportedVersion: undefined,
      };
      break;
    default:
      return assertNever(event);
  }

  return commitTransition(current, next, event.type, metadata, onTransition);
}

export interface JobMachineState {
  readonly kind: JobKind;
  readonly status: JobStateStatus;
  readonly inputVersion: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly manualFallbackRequired: boolean;
  readonly errorCode?: string;
}

export type JobEvent =
  | { readonly type: 'START' }
  | { readonly type: 'SUCCEED' }
  | { readonly type: 'FAIL'; readonly retryable: boolean; readonly errorCode?: string }
  | { readonly type: 'REQUEUE' };

export function createJobState(
  kind: JobKind,
  inputVersion: number,
  maxAttempts: number,
): JobMachineState {
  assertPositiveInteger(inputVersion, 'inputVersion');
  assertPositiveInteger(maxAttempts, 'maxAttempts');
  return {
    kind,
    status: 'QUEUED',
    inputVersion,
    attemptCount: 0,
    maxAttempts,
    manualFallbackRequired: false,
  };
}

export function transitionJob(
  current: JobMachineState,
  event: JobEvent,
  metadata: TransitionMetadata,
  onTransition?: TransitionHook<JobStateStatus, JobEvent['type']>,
): TransitionResult<JobMachineState, JobStateStatus, JobEvent['type']> {
  assertTrustedEvent(event);
  assertMetadata(metadata);
  if (metadata.inputVersion !== current.inputVersion) {
    reject('VALIDATION_FAILED', 'Job transition metadata must reference the job input version.');
  }

  let next: JobMachineState;
  switch (event.type) {
    case 'START':
      requireStatus(current, 'QUEUED');
      if (current.attemptCount >= current.maxAttempts) {
        reject(
          'RETRY_EXHAUSTED',
          'The job has exhausted its attempts and requires manual fallback.',
        );
      }
      next = { ...current, status: 'RUNNING', attemptCount: current.attemptCount + 1 };
      break;
    case 'SUCCEED':
      requireStatus(current, 'RUNNING');
      next = {
        ...current,
        status: 'SUCCEEDED',
        manualFallbackRequired: false,
        errorCode: undefined,
      };
      break;
    case 'FAIL': {
      requireStatus(current, 'RUNNING');
      const redactedErrorCode = redactErrorCode(event.errorCode ?? metadata.errorCode);
      if (event.retryable && current.attemptCount < current.maxAttempts) {
        next = { ...current, status: 'RETRYABLE_FAILURE', errorCode: redactedErrorCode };
      } else {
        next = {
          ...current,
          status: 'TERMINAL_FAILURE',
          manualFallbackRequired: true,
          errorCode: redactedErrorCode,
        };
      }
      break;
    }
    case 'REQUEUE':
      requireStatus(current, 'RETRYABLE_FAILURE');
      if (current.attemptCount >= current.maxAttempts) {
        reject('RETRY_EXHAUSTED', 'The job cannot be requeued after retry exhaustion.');
      }
      next = { ...current, status: 'QUEUED' };
      break;
    default:
      return assertNever(event);
  }

  const transitionErrorCode =
    event.type === 'FAIL' ? redactErrorCode(event.errorCode ?? metadata.errorCode) : undefined;
  return commitTransition(current, next, event.type, metadata, onTransition, transitionErrorCode);
}

function commitTransition<
  TState extends { readonly status: S; readonly inputVersion: number },
  S extends string,
  E extends string,
>(
  current: TState,
  next: TState,
  event: E,
  metadata: TransitionMetadata,
  onTransition?: TransitionHook<S, E>,
  errorCodeOverride?: string,
): TransitionResult<TState, S, E> {
  const redactedErrorCode = errorCodeOverride ?? redactErrorCode(metadata.errorCode);
  const transition: TransitionRecord<S, E> = {
    from: current.status,
    to: next.status,
    event,
    inputVersion: metadata.inputVersion,
    attemptCount: metadata.attemptCount,
    ...(redactedErrorCode ? { redactedErrorCode } : {}),
    sourceRecordId: metadata.sourceRecordId,
    occurredAt: metadata.occurredAt ?? new Date(0),
  };
  onTransition?.(transition);
  return { state: next, transition };
}

function assertTrustedEvent(event: object): void {
  const candidate = event as Record<string, unknown>;
  if (
    'status' in candidate ||
    'nextStatus' in candidate ||
    'nextState' in candidate ||
    'desiredState' in candidate
  ) {
    reject('REQUEST_INVALID', 'Client state assignment is not accepted; use a transition event.');
  }
}

function assertMetadata(metadata: TransitionMetadata): void {
  assertPositiveInteger(metadata.inputVersion, 'transition inputVersion');
  if (!Number.isSafeInteger(metadata.attemptCount) || metadata.attemptCount < 0) {
    reject('VALIDATION_FAILED', 'transition attemptCount must be a non-negative integer.');
  }
  assertRequiredText(metadata.sourceRecordId, 'sourceRecordId');
  if (metadata.maxAttempts !== undefined)
    assertPositiveInteger(metadata.maxAttempts, 'maxAttempts');
  if (metadata.occurredAt && Number.isNaN(metadata.occurredAt.getTime())) {
    reject('VALIDATION_FAILED', 'occurredAt must be a valid date.');
  }
}

function assertInputVersion(
  current: { readonly inputVersion: number },
  event: { readonly type: string },
  metadata: TransitionMetadata,
): void {
  if (
    event.type !== 'INPUT_CHANGED' &&
    event.type !== 'AUTHORIZATION_CONTEXT_CHANGED' &&
    metadata.inputVersion !== current.inputVersion
  ) {
    reject('VALIDATION_FAILED', 'Transition metadata must reference the current input version.');
  }
}

function assertRetryAvailable(metadata: TransitionMetadata): void {
  if (metadata.maxAttempts === undefined || metadata.attemptCount >= metadata.maxAttempts) {
    reject('RETRY_EXHAUSTED', 'Retry attempts are exhausted; use manual fallback.');
  }
}

function assertAuthorization(authorization: AuthorizationBinding): void {
  assertRequiredText(authorization.exactNoteUrl, 'exactNoteUrl');
  assertRequiredText(authorization.normalizedNoteUrl, 'normalizedNoteUrl');
  assertRequiredText(authorization.toolId, 'toolId');
  assertRequiredText(authorization.purpose, 'purpose');
  if (Number.isNaN(authorization.confirmedAt.getTime())) {
    reject('VALIDATION_FAILED', 'confirmedAt must be a valid date.');
  }
  if (authorization.expiresAt && Number.isNaN(authorization.expiresAt.getTime())) {
    reject('VALIDATION_FAILED', 'expiresAt must be a valid date.');
  }
}

function isAuthorizationValid(authorization: AuthorizationBinding, noteUrl?: string): boolean {
  const now = new Date();
  return (
    authorization.exactNoteUrl === noteUrl &&
    (!authorization.expiresAt || authorization.expiresAt.getTime() > now.getTime())
  );
}

function requireStatus<T extends { readonly status: string }>(
  current: T,
  expected: T['status'],
): void {
  if (current.status !== expected) {
    reject('REQUEST_INVALID', `Illegal transition from ${current.status}; expected ${expected}.`);
  }
}

function reject(code: StateMachineErrorCode, reason: string): never {
  throw new StateTransitionRejectedError(code, reason);
}

function assertRequiredText(value: string, name: string): void {
  if (!value.trim()) reject('VALIDATION_FAILED', `${name} is required.`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    reject('VALIDATION_FAILED', `${name} must be a positive integer.`);
}

function countAnswers(answers: ThreeAnswers): number {
  return answers.filter((answer) => typeof answer === 'string' && answer.trim().length > 0).length;
}

const SAFE_ERROR_CODES = new Set([
  'VALIDATION_FAILED',
  'BRIEF_INCOMPLETE',
  'QUESTION_SET_INVALID',
  'FILE_UNREADABLE',
  'MODEL_NOT_AVAILABLE',
  'MODEL_RATE_LIMITED',
  'MODEL_OUTPUT_INVALID',
  'COMPLIANCE_BLOCKED',
  'COVER_UNAVAILABLE',
  'COVER_RATIO_INVALID',
  'AUTHORIZATION_REQUIRED',
  'OPENCLI_NOT_CONFIGURED',
  'OPENCLI_FORBIDDEN',
  'OPENCLI_TIMEOUT',
  'METRIC_MISSING',
  'THRESHOLD_BOUNDARY',
  'CONFIGURATION_MISSING',
  'VERSION_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'RATE_LIMITED',
  'RETRY_EXHAUSTED',
  'INTERNAL_ERROR',
]);

export function redactErrorCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (SAFE_ERROR_CODES.has(normalized)) return normalized;
  return 'REDACTED_ERROR';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled state event: ${JSON.stringify(value)}`);
}
