import 'server-only';

import {
  PublicApplicationError,
  type PublicErrorAction,
  type PublicErrorDTO,
  type PublicErrorCode,
} from './public-errors';

export type PublicModelErrorCode = Extract<
  PublicErrorCode,
  'CONFIGURATION_MISSING' | 'MODEL_NOT_AVAILABLE' | 'MODEL_RATE_LIMITED' | 'MODEL_OUTPUT_INVALID'
>;
export type ModelErrorAction = Extract<
  PublicErrorAction,
  'FIX_CONFIGURATION_OR_MANUAL' | 'RETRY_OR_MANUAL' | 'EDIT_MANUALLY'
>;

export class PublicModelError extends PublicApplicationError {
  readonly requestId: string;

  constructor(input: {
    readonly code: PublicModelErrorCode;
    readonly requestId: string;
    readonly traceId: string;
    readonly retryable?: boolean;
    readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    readonly currentVersion?: number;
    readonly sourceRecordId?: string;
  }) {
    super(input);
    this.name = 'PublicModelError';
    this.requestId = input.requestId;
  }

  override toDTO(traceId = this.traceId): PublicErrorDTO {
    return super.toDTO(traceId);
  }
}

export function isPublicModelError(error: unknown): error is PublicModelError {
  return error instanceof PublicModelError;
}
