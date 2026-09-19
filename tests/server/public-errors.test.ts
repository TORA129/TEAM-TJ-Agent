import { describe, expect, it } from 'vitest';

import {
  PUBLIC_ERROR_POLICIES,
  PublicApplicationError,
  getRetryFallbackMetadata,
  redactPublicText,
  redactSensitiveValue,
  toPublicErrorDTO,
} from '../../server/public-errors';
import { routeErrorResponse, RouteGuardError } from '../../server/http/errors';

const requiredCodes = [
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
] as const;

describe('shared public error contract', () => {
  it('publishes every task 3.1 error family with deterministic action metadata', () => {
    expect(Object.keys(PUBLIC_ERROR_POLICIES)).toEqual(expect.arrayContaining([...requiredCodes]));

    for (const code of requiredCodes) {
      const policy = PUBLIC_ERROR_POLICIES[code];
      const metadata = getRetryFallbackMetadata(code);
      const error = new PublicApplicationError({
        code,
        traceId: 'trace-3-1',
        currentVersion: 7,
        sourceRecordId: 'source-7',
      });
      const dto = error.toDTO();

      expect(dto).toEqual({
        code,
        message: policy.message,
        action: policy.action,
        retryable: policy.retryable,
        currentVersion: 7,
        sourceRecordId: 'source-7',
        traceId: 'trace-3-1',
      });
      expect(metadata).toEqual({
        retryable: policy.retryable,
        maxAttempts: policy.maxAttempts,
        backoffMs: policy.backoffMs,
        action: policy.action,
      });
      expect(metadata.maxAttempts).toBeGreaterThanOrEqual(0);
      expect(metadata.backoffMs).toBeGreaterThanOrEqual(0);
      expect(metadata.retryable).toBe(metadata.maxAttempts > 0);
    }
  });

  it('keeps field errors useful while redacting credentials, headers, environment values and paths', () => {
    const dto = toPublicErrorDTO(new Error('third-party failure'), {
      code: 'VALIDATION_FAILED',
      traceId: 'trace-redaction',
      fieldErrors: {
        brief: [
          'OPENROUTER_API_KEY=top-secret-value',
          'Authorization: Bearer bearer-secret-value',
          'invalid file at C:\\Users\\huang\\Desktop\\private.txt',
        ],
      },
    });
    const serialized = JSON.stringify(dto);

    expect(dto.fieldErrors?.brief?.[0]).toContain('[redacted environment value]');
    expect(serialized).not.toContain('top-secret-value');
    expect(serialized).not.toContain('bearer-secret-value');
    expect(serialized).not.toContain('C:\\Users\\huang');
    expect(serialized).not.toContain('private.txt');
    expect(dto.message).toBe(PUBLIC_ERROR_POLICIES.VALIDATION_FAILED.message);
  });

  it('never copies arbitrary provider errors, stacks or headers into a public reason', () => {
    const secret = 'third-party-secret-value';
    const arbitraryError = Object.assign(
      new Error(
        `provider failed ${secret}\n at C:\\workspace\\server\\adapter.ts:10:2\nAuthorization: Bearer ${secret}`,
      ),
      {
        status: 503,
        headers: { authorization: `Bearer ${secret}` },
        env: { OPENROUTER_API_KEY: secret },
        stack: `Error: ${secret}\n at /workspace/server.ts:1:1`,
      },
    );

    const dto = toPublicErrorDTO(arbitraryError, {
      traceId: 'trace-provider',
      code: 'MODEL_NOT_AVAILABLE',
    });

    expect(dto).toMatchObject({
      code: 'MODEL_NOT_AVAILABLE',
      message: PUBLIC_ERROR_POLICIES.MODEL_NOT_AVAILABLE.message,
      action: 'RETRY_OR_MANUAL',
      retryable: true,
      traceId: 'trace-provider',
    });
    expect(JSON.stringify(dto)).not.toContain(secret);
    expect(JSON.stringify(dto)).not.toContain('workspace');
    expect(JSON.stringify(dto)).not.toContain('Authorization');
  });

  it('classifies an arbitrary 429 safely without exposing the provider response', () => {
    const dto = toPublicErrorDTO(
      { status: 429, message: 'secret provider response' },
      {
        traceId: 'trace-rate',
      },
    );

    expect(dto).toMatchObject({
      code: 'RATE_LIMITED',
      action: 'WAIT_OR_CONTACT_OPERATOR',
      retryable: true,
      traceId: 'trace-rate',
    });
    expect(JSON.stringify(dto)).not.toContain('secret provider response');
  });

  it('redacts nested diagnostic values before they can be logged or returned', () => {
    const redacted = redactSensitiveValue({
      headers: { authorization: 'Bearer secret-token' },
      env: { OPENROUTER_API_KEY: 'api-secret' },
      nested: ['C:\\Users\\huang\\private.txt', 'safe detail'],
    });

    expect(redacted).toEqual({
      headers: { authorization: '[redacted]' },
      env: { OPENROUTER_API_KEY: '[redacted]' },
      nested: ['[internal path]', 'safe detail'],
    });
    expect(redactPublicText('Authorization: Bearer secret-token')).not.toContain('secret-token');
  });

  it('serializes route failures with the same DTO and no caller-controlled message', async () => {
    const response = routeErrorResponse(
      new RouteGuardError({
        status: 400,
        code: 'REQUEST_INVALID',
        message: 'internal path C:\\workspace\\secret',
        action: 'leak internal action',
        traceId: 'trace-route',
      }),
      'trace-route',
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'REQUEST_INVALID',
      message: PUBLIC_ERROR_POLICIES.REQUEST_INVALID.message,
      action: 'FIX_FIELDS',
      retryable: false,
      traceId: 'trace-route',
    });
    expect(JSON.stringify(body)).not.toContain('workspace');
    expect(JSON.stringify(body)).not.toContain('leak internal action');
  });
});
