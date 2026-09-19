import 'server-only';

import { randomUUID } from 'node:crypto';

import { redactPublicText } from './security/redaction';

export { redactPublicText, redactSensitiveValue } from './security/redaction';

export type PublicErrorAction =
  | 'FIX_FIELDS'
  | 'ANSWER_CLARIFYING_QUESTIONS'
  | 'RELOAD_CURRENT_QUESTION_SET'
  | 'CONTINUE_WITH_BRIEF_OR_REPLACE_FILE'
  | 'FIX_CONFIGURATION_OR_MANUAL'
  | 'RETRY_OR_MANUAL'
  | 'EDIT_MANUALLY'
  | 'EDIT_OR_ADD_SOURCE'
  | 'REGENERATE_OR_CROP_OR_UPLOAD'
  | 'CONFIRM_AUTHORIZATION_OR_MANUAL_INPUT'
  | 'CONFIGURE_GATEWAY_OR_MANUAL_INPUT'
  | 'NEW_AUTHORIZATION_OR_MANUAL_INPUT'
  | 'WAIT_AND_RETRY_OR_MANUAL'
  | 'ENTER_METRIC_VALUES'
  | 'CONFIRM_OR_CHANGE_THRESHOLDS'
  | 'RELOAD_AND_REAPPLY_CHANGES'
  | 'REVIEW_AND_CONFIRM_VERSION'
  | 'WAIT_OR_CONTACT_OPERATOR'
  | 'RETRY_OR_USE_MANUAL_FALLBACK'
  | 'RETRY_REQUEST_OR_CONTACT_OPERATOR'
  | 'RELOAD_JOB';

export const PUBLIC_ERROR_POLICIES = {
  VALIDATION_FAILED: {
    status: 400,
    message: '输入内容未通过校验，请修正标记的字段。',
    action: 'FIX_FIELDS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  BRIEF_INCOMPLETE: {
    status: 400,
    message: '创作信息不完整，请回答 3 个澄清问题或补齐信息。',
    action: 'ANSWER_CLARIFYING_QUESTIONS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  QUESTION_SET_INVALID: {
    status: 409,
    message: '澄清问题集已失效或格式不正确，请重新加载当前问题集。',
    action: 'RELOAD_CURRENT_QUESTION_SET',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  FILE_UNREADABLE: {
    status: 422,
    message: '补充文件无法读取，请仅使用创作信息或替换文件。',
    action: 'CONTINUE_WITH_BRIEF_OR_REPLACE_FILE',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  MODEL_NOT_AVAILABLE: {
    status: 503,
    message: '模型服务暂时不可用，请重试或改用人工编辑。',
    action: 'RETRY_OR_MANUAL',
    retryable: true,
    maxAttempts: 1,
    backoffMs: 1_000,
  },
  MODEL_RATE_LIMITED: {
    status: 429,
    message: '免费模型当前受到限流，请稍后重试或改用人工编辑。',
    action: 'RETRY_OR_MANUAL',
    retryable: true,
    maxAttempts: 2,
    backoffMs: 2_000,
  },
  MODEL_OUTPUT_INVALID: {
    status: 422,
    message: '模型返回内容无法通过结构化校验，请编辑内容或重试。',
    action: 'EDIT_MANUALLY',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  COMPLIANCE_BLOCKED: {
    status: 422,
    message: '内容未通过合规检查，请删除、改写或补充来源。',
    action: 'EDIT_OR_ADD_SOURCE',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  COVER_UNAVAILABLE: {
    status: 503,
    message: '封面图能力暂时不可用，请重试或上传替代封面。',
    action: 'REGENERATE_OR_CROP_OR_UPLOAD',
    retryable: true,
    maxAttempts: 1,
    backoffMs: 1_000,
  },
  COVER_RATIO_INVALID: {
    status: 422,
    message: '生成的封面不是 3:4 比例，请重新生成或人工处理后上传。',
    action: 'REGENERATE_OR_CROP_OR_UPLOAD',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  AUTHORIZATION_REQUIRED: {
    status: 403,
    message: '访问该笔记前需要完成与当前网址绑定的授权确认。',
    action: 'CONFIRM_AUTHORIZATION_OR_MANUAL_INPUT',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  OPENCLI_NOT_CONFIGURED: {
    status: 503,
    message: '授权访问工具尚未配置，请配置网关或改用人工输入。',
    action: 'CONFIGURE_GATEWAY_OR_MANUAL_INPUT',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  OPENCLI_FORBIDDEN: {
    status: 403,
    message: '当前账号或平台限制不允许访问该内容，请重新授权或改用人工输入。',
    action: 'NEW_AUTHORIZATION_OR_MANUAL_INPUT',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  OPENCLI_TIMEOUT: {
    status: 504,
    message: '授权访问工具响应超时，请稍后重试或改用人工输入。',
    action: 'WAIT_AND_RETRY_OR_MANUAL',
    retryable: true,
    maxAttempts: 2,
    backoffMs: 2_000,
  },
  METRIC_MISSING: {
    status: 422,
    message: '复盘指标缺失，请人工录入后再评估。',
    action: 'ENTER_METRIC_VALUES',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  THRESHOLD_BOUNDARY: {
    status: 422,
    message: '指标处于阈值边界，请人工确认或调整阈值集。',
    action: 'CONFIRM_OR_CHANGE_THRESHOLDS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  CONFIGURATION_MISSING: {
    status: 503,
    message: '服务端集成配置不完整，请修正配置或使用人工回退。',
    action: 'FIX_CONFIGURATION_OR_MANUAL',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  VERSION_CONFLICT: {
    status: 409,
    message: '当前版本已发生变化，请重新加载后再提交修改。',
    action: 'RELOAD_AND_REAPPLY_CHANGES',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  CONFIRMATION_REQUIRED: {
    status: 409,
    message: '请先审阅并确认当前版本，再继续保存或导出。',
    action: 'REVIEW_AND_CONFIRM_VERSION',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  RATE_LIMITED: {
    status: 429,
    message: '请求或外部调用已达到限额，请稍后重试或改用人工处理。',
    action: 'WAIT_OR_CONTACT_OPERATOR',
    retryable: true,
    maxAttempts: 2,
    backoffMs: 2_000,
  },
  RETRY_EXHAUSTED: {
    status: 503,
    message: '自动重试次数已用尽，请改用人工回退或联系部署方。',
    action: 'RETRY_OR_USE_MANUAL_FALLBACK',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  JOB_RETRYABLE_FAILURE: {
    status: 503,
    message: '外部服务暂时不可用，系统将按上限重试或转入人工回退。',
    action: 'WAIT_AND_RETRY_OR_MANUAL',
    retryable: true,
    maxAttempts: 1,
    backoffMs: 2_000,
  },
  JOB_NOT_FOUND: {
    status: 404,
    message: '找不到该任务，可能已过期或无权访问。',
    action: 'RELOAD_JOB',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    message: '需要有效的 Operator 会话才能继续。',
    action: 'RETRY_REQUEST_OR_CONTACT_OPERATOR',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  ORIGIN_FORBIDDEN: {
    status: 403,
    message: '请求来源不被允许。',
    action: 'FIX_FIELDS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  CSRF_INVALID: {
    status: 403,
    message: '请求安全校验未通过，请刷新页面后重试。',
    action: 'RELOAD_AND_REAPPLY_CHANGES',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  REQUEST_BODY_TOO_LARGE: {
    status: 413,
    message: '请求内容超过允许大小，请缩小后重试。',
    action: 'FIX_FIELDS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: '请求格式不受支持，请使用允许的格式。',
    action: 'FIX_FIELDS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  REQUEST_CONTEXT_INVALID: {
    status: 400,
    message: 'The request context is invalid.',
    action: 'RELOAD_AND_REAPPLY_CHANGES',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    message: '请求缺少幂等标识，请重新提交。',
    action: 'RETRY_REQUEST_OR_CONTACT_OPERATOR',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  REQUEST_INVALID: {
    status: 400,
    message: '请求内容无效，请检查后重试。',
    action: 'FIX_FIELDS',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
  INTERNAL_ERROR: {
    status: 500,
    message: '请求无法完成，请稍后重试或联系部署方。',
    action: 'RETRY_REQUEST_OR_CONTACT_OPERATOR',
    retryable: false,
    maxAttempts: 0,
    backoffMs: 0,
  },
} as const satisfies Record<
  string,
  {
    readonly status: number;
    readonly message: string;
    readonly action: PublicErrorAction;
    readonly retryable: boolean;
    readonly maxAttempts: number;
    readonly backoffMs: number;
  }
>;

export type PublicErrorCode = keyof typeof PUBLIC_ERROR_POLICIES;
export type PublicErrorPolicy = (typeof PUBLIC_ERROR_POLICIES)[PublicErrorCode];
export type PublicFieldErrors = Readonly<Record<string, readonly string[]>>;

export interface PublicErrorDTO {
  readonly code: PublicErrorCode;
  readonly message: string;
  readonly action: PublicErrorAction;
  readonly retryable: boolean;
  readonly fieldErrors?: PublicFieldErrors;
  readonly currentVersion?: number;
  readonly sourceRecordId?: string;
  readonly traceId: string;
}

export interface PublicErrorContext {
  readonly traceId?: string;
  readonly code?: PublicErrorCode;
  readonly status?: number;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly currentVersion?: number;
  readonly sourceRecordId?: string;
}

export interface RetryFallbackMetadata {
  readonly retryable: boolean;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly action: PublicErrorAction;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_FIELD_PATTERN = /^[A-Za-z0-9_.[\]-]{1,120}$/;

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

function normalizeTraceId(value: unknown): string {
  return isSafeId(value) ? value : randomUUID();
}

function normalizeVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeFieldErrors(
  fieldErrors: Readonly<Record<string, readonly string[]>> | undefined,
): PublicFieldErrors | undefined {
  if (!fieldErrors) return undefined;
  const entries = Object.entries(fieldErrors)
    .filter(([field]) => SAFE_FIELD_PATTERN.test(field))
    .map(
      ([field, messages]) =>
        [
          field,
          (Array.isArray(messages) ? messages : [String(messages)])
            .slice(0, 5)
            .map((message) => redactPublicText(String(message))),
        ] as const,
    );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function codeFromUnknown(error: unknown, fallback: PublicErrorCode): PublicErrorCode {
  if (error && typeof error === 'object') {
    const candidate = error as { readonly code?: unknown; readonly status?: unknown };
    if (typeof candidate.code === 'string' && candidate.code in PUBLIC_ERROR_POLICIES) {
      return candidate.code as PublicErrorCode;
    }
    if (candidate.status === 429) return 'RATE_LIMITED';
  }
  return fallback;
}

export class PublicApplicationError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;
  readonly action: PublicErrorAction;
  readonly retryable: boolean;
  readonly fieldErrors?: PublicFieldErrors;
  readonly currentVersion?: number;
  readonly sourceRecordId?: string;
  readonly traceId: string;
  readonly retryAfterSeconds?: number;

  constructor(input: {
    readonly code: PublicErrorCode;
    readonly traceId?: string;
    readonly status?: number;
    readonly retryable?: boolean;
    readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    readonly currentVersion?: number;
    readonly sourceRecordId?: string;
    readonly retryAfterSeconds?: number;
  }) {
    const policy = PUBLIC_ERROR_POLICIES[input.code];
    super(policy.message);
    this.name = 'PublicApplicationError';
    this.status = input.status ?? policy.status;
    this.code = input.code;
    this.action = policy.action;
    this.retryable = input.retryable ?? policy.retryable;
    this.fieldErrors = normalizeFieldErrors(input.fieldErrors);
    this.currentVersion = normalizeVersion(input.currentVersion);
    this.sourceRecordId = isSafeId(input.sourceRecordId) ? input.sourceRecordId : undefined;
    this.traceId = normalizeTraceId(input.traceId);
    this.retryAfterSeconds =
      typeof input.retryAfterSeconds === 'number' &&
      Number.isSafeInteger(input.retryAfterSeconds) &&
      input.retryAfterSeconds > 0
        ? input.retryAfterSeconds
        : undefined;
  }

  toDTO(traceId = this.traceId): PublicErrorDTO {
    return {
      code: this.code,
      message: this.message,
      action: this.action,
      retryable: this.retryable,
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
      ...(this.currentVersion !== undefined ? { currentVersion: this.currentVersion } : {}),
      ...(this.sourceRecordId ? { sourceRecordId: this.sourceRecordId } : {}),
      traceId: normalizeTraceId(traceId),
    };
  }
}

export function isPublicErrorCode(value: unknown): value is PublicErrorCode {
  return typeof value === 'string' && value in PUBLIC_ERROR_POLICIES;
}

export function getPublicErrorPolicy(code: PublicErrorCode): PublicErrorPolicy {
  return PUBLIC_ERROR_POLICIES[code];
}

export function getRetryFallbackMetadata(code: PublicErrorCode): RetryFallbackMetadata {
  const { retryable, maxAttempts, backoffMs, action } = PUBLIC_ERROR_POLICIES[code];
  return { retryable, maxAttempts, backoffMs, action };
}

export function toPublicErrorDTO(error: unknown, context: PublicErrorContext = {}): PublicErrorDTO {
  if (error instanceof PublicApplicationError) {
    return error.toDTO(context.traceId);
  }

  const code = codeFromUnknown(error, context.code ?? 'INTERNAL_ERROR');
  const policy = PUBLIC_ERROR_POLICIES[code];
  return {
    code,
    message: policy.message,
    action: policy.action,
    retryable: policy.retryable,
    ...(normalizeFieldErrors(context.fieldErrors)
      ? { fieldErrors: normalizeFieldErrors(context.fieldErrors) }
      : {}),
    ...(normalizeVersion(context.currentVersion) !== undefined
      ? { currentVersion: normalizeVersion(context.currentVersion) }
      : {}),
    ...(isSafeId(context.sourceRecordId) ? { sourceRecordId: context.sourceRecordId } : {}),
    traceId: normalizeTraceId(context.traceId),
  };
}

export function toPublicApplicationError(
  error: unknown,
  context: PublicErrorContext = {},
): PublicApplicationError {
  if (error instanceof PublicApplicationError) return error;
  const code = codeFromUnknown(error, context.code ?? 'INTERNAL_ERROR');
  return new PublicApplicationError({ ...context, code });
}
