import 'server-only';

import { randomUUID } from 'node:crypto';

import type { AuditEventRepository } from '../domain/persistence/repositories';
import type { ModelMetadata, UUID } from '../domain/persistence/models';
import type { ServerConfiguration } from './config';
import {
  isOpenRouterFreeModelId,
  OpenRouterModelCatalog,
  type ModelCapabilityRequirements,
} from './openrouter-model-catalog';
import { type PiAiToolMetadata, type PiAiToolRegistry } from './pi-ai-tools';
import {
  redactModelMessages,
  redactSensitiveValue,
  safeJsonStringify,
  type ModelMessageLike,
} from './security/redaction';
import { PublicModelError, isPublicModelError } from './model-errors';

export type PiAiRole = 'system' | 'user' | 'assistant';

export interface PiAiMessage {
  readonly role: PiAiRole;
  readonly content: string;
}

export interface StructuredOutputSpec {
  readonly name: string;
  readonly schema: Record<string, unknown>;
}

export interface PiAiRequest {
  readonly provider: 'openrouter';
  readonly model: string;
  readonly baseUrl: string;
  readonly requestId: string;
  readonly messages: readonly PiAiMessage[];
  readonly responseFormat: StructuredOutputSpec;
  /** Only metadata from the server-side allowlist may be sent to pi-ai. */
  readonly tools?: readonly PiAiToolMetadata[];
  readonly outputModalities?: readonly string[];
  readonly signal: AbortSignal;
}

export interface PiAiUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

/**
 * The smallest runtime surface needed from a pi-ai integration.
 *
 * pi-ai is intentionally not imported here because it is not installed in the
 * current foundation. A future server-only bridge should translate pi-ai's
 * model/stream API into this boundary. Tests use a controlled implementation;
 * neither implementation is allowed to perform a real network call here.
 */
export interface PiAiRuntime {
  generate(request: PiAiRequest): Promise<PiAiRuntimeResponse>;
  stream?(request: PiAiRequest): AsyncIterable<PiAiRuntimeStreamEvent>;
}

export interface PiAiRuntimeResponse {
  readonly text?: string;
  readonly structuredOutput?: unknown;
  readonly modelId?: string;
  readonly usage?: PiAiUsage;
}

export type PiAiRuntimeStreamEvent =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'structured_output'; readonly value: unknown }
  | { readonly type: 'usage'; readonly usage: PiAiUsage }
  | {
      readonly type: 'done';
      readonly text?: string;
      readonly value?: unknown;
      readonly modelId?: string;
    }
  | { readonly type: 'error'; readonly status?: number; readonly code?: string };

export interface ModelLimits {
  readonly timeoutMs: number;
  readonly maxInputChars: number;
  readonly maxOutputChars: number;
  readonly maxConcurrentRequests: number;
  readonly maxRequestsPerMinute: number;
}

export const DEFAULT_MODEL_LIMITS: ModelLimits = {
  timeoutMs: 30_000,
  maxInputChars: 80_000,
  maxOutputChars: 40_000,
  maxConcurrentRequests: 2,
  maxRequestsPerMinute: 20,
};

export interface StructuredModelInput<T> {
  readonly jobId: string;
  readonly entityId: UUID;
  readonly traceId?: string;
  readonly requestId?: string;
  readonly sourceRecordId?: UUID;
  readonly messages: readonly PiAiMessage[];
  readonly output: StructuredOutputSpec & {
    readonly parse: (value: unknown) => T;
  };
}

export interface ModelCallResult<T> {
  readonly value: T;
  readonly text: string;
  readonly metadata: ModelMetadata;
  readonly usage?: PiAiUsage;
}

export type ModelStreamEvent<T> =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'usage'; readonly usage: PiAiUsage }
  | { readonly type: 'structured'; readonly value: T }
  | { readonly type: 'done'; readonly result: ModelCallResult<T> };

export interface SafeModelAuditEvent {
  readonly action: 'MODEL_GENERATE' | 'MODEL_STREAM';
  readonly jobId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly entityType: string;
  readonly entityId: UUID;
  readonly sourceRecordId?: UUID;
  readonly resultStatus: 'SUCCEEDED' | 'FAILED';
  readonly providerId: 'openrouter';
  readonly modelId: string;
  readonly durationMs: number;
  readonly errorCode?: PublicModelError['code'];
}

export interface ModelAuditSink {
  record(event: SafeModelAuditEvent): Promise<void> | void;
}

/**
 * Maps the existing AuditEventRepository contract to the adapter's safe audit
 * event. No provider response, error, credential, header, or prompt is saved.
 */
export function createModelAuditSink(repository: AuditEventRepository): ModelAuditSink {
  return {
    async record(event) {
      await repository.append({
        actorType: 'MODEL',
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        reason: `jobId=${event.jobId};requestId=${event.requestId}`,
        resultStatus: event.resultStatus,
        sourceRecordId: event.sourceRecordId,
        providerId: event.providerId,
        modelId: event.modelId,
        traceId: event.traceId,
      });
    },
  };
}

export interface PiAiModelAdapterConfig {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly hasCredential: boolean;
}

export interface PiAiModelAdapterOptions {
  readonly config: PiAiModelAdapterConfig;
  readonly runtime: PiAiRuntime;
  readonly limits?: Partial<ModelLimits>;
  readonly audit?: ModelAuditSink;
  readonly entityType?: string;
  /** Optional server-only catalog gate for task capabilities and actual model IDs. */
  readonly catalog?: OpenRouterModelCatalog;
  readonly modelRequirements?: ModelCapabilityRequirements;
  /** Server-only registry; arbitrary model-supplied tool definitions are not accepted. */
  readonly toolRegistry?: PiAiToolRegistry;
}

/**
 * Creates the adapter from the existing server configuration while retaining
 * only a boolean credential presence flag. The pi-ai runtime bridge owns the
 * actual server credential and is never given a client-visible DTO by this
 * adapter.
 */
export function createPiAiModelAdapter(
  config: ServerConfiguration,
  runtime: PiAiRuntime,
  options: Omit<PiAiModelAdapterOptions, 'config' | 'runtime'> = {},
): PiAiModelAdapter {
  return new PiAiModelAdapter({
    ...options,
    runtime,
    config: {
      provider: config.piAi.provider,
      model: config.openRouter.model,
      baseUrl: config.openRouter.baseUrl,
      hasCredential: Boolean(config.openRouter.apiKey ?? config.piAi.apiKey),
    },
    limits: {
      timeoutMs: config.jobs.timeoutMs,
      ...options.limits,
    },
  });
}

function isFreeModel(model: string): boolean {
  return isOpenRouterFreeModelId(model);
}

function catalogSelectionError(
  selection: ReturnType<OpenRouterModelCatalog['select']>,
  requestId: string,
  traceId: string,
): PublicModelError {
  return new PublicModelError({
    code:
      selection.status === 'rate_limited'
        ? 'MODEL_RATE_LIMITED'
        : selection.status === 'configuration_missing'
          ? 'CONFIGURATION_MISSING'
          : 'MODEL_NOT_AVAILABLE',
    requestId,
    traceId,
    retryable: selection.status === 'rate_limited' || selection.status === 'unavailable',
  });
}

function safeRuntimeFailureCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { readonly code?: unknown; readonly status?: unknown };
  if (typeof candidate.code === 'string') return candidate.code.toLowerCase();
  if (typeof candidate.status === 'number') return String(candidate.status);
  return undefined;
}

function isRateLimited(error: unknown): boolean {
  const code = safeRuntimeFailureCode(error);
  return code === '429' || code === 'rate_limit' || code === 'rate_limited';
}

function isTimedOut(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { readonly name?: unknown; readonly code?: unknown };
  return candidate.name === 'TimeoutError' || candidate.code === 'timeout';
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function parseOutput<T>(
  response: Pick<PiAiRuntimeResponse, 'text' | 'structuredOutput'>,
  parse: (value: unknown) => T,
): { readonly value: T; readonly text: string } {
  const hasStructured = response.structuredOutput !== undefined;
  const rawText =
    response.text ?? (hasStructured ? safeJsonStringify(response.structuredOutput) : '');
  if (!hasStructured && rawText.trim() === '') {
    throw new Error('empty model output');
  }

  let value: unknown = response.structuredOutput;
  if (!hasStructured) {
    try {
      value = JSON.parse(stripJsonFence(rawText));
    } catch {
      throw new Error('model output is not valid JSON');
    }
  }

  try {
    const safeValue = redactSensitiveValue(value);
    return { value: parse(safeValue), text: safeJsonStringify(safeValue) };
  } catch {
    throw new Error('model output failed schema validation');
  }
}

function timeoutPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      clearTimeout(timer);
      reject(Object.assign(new Error('model request timed out'), { code: 'timeout' }));
    }, timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function normalizedLimits(limits?: Partial<ModelLimits>): ModelLimits {
  const result = { ...DEFAULT_MODEL_LIMITS, ...limits };
  if (
    !Number.isInteger(result.timeoutMs) ||
    result.timeoutMs < 1 ||
    !Number.isInteger(result.maxInputChars) ||
    result.maxInputChars < 1 ||
    !Number.isInteger(result.maxOutputChars) ||
    result.maxOutputChars < 1 ||
    !Number.isInteger(result.maxConcurrentRequests) ||
    result.maxConcurrentRequests < 1 ||
    !Number.isInteger(result.maxRequestsPerMinute) ||
    result.maxRequestsPerMinute < 1
  ) {
    throw new Error('invalid model limits');
  }
  return result;
}

export class PiAiModelAdapter {
  private readonly config: PiAiModelAdapterConfig;
  private readonly runtime: PiAiRuntime;
  private readonly limits: ModelLimits;
  private readonly audit?: ModelAuditSink;
  private readonly entityType: string;
  private readonly catalog?: OpenRouterModelCatalog;
  private readonly modelRequirements: ModelCapabilityRequirements;
  private readonly toolRegistry?: PiAiToolRegistry;
  private activeRequests = 0;
  private readonly requestTimestamps: number[] = [];

  constructor(options: PiAiModelAdapterOptions) {
    this.config = options.config;
    this.runtime = options.runtime;
    this.limits = normalizedLimits(options.limits);
    this.audit = options.audit;
    this.entityType = options.entityType ?? 'MODEL_OUTPUT';
    this.catalog = options.catalog;
    this.toolRegistry = options.toolRegistry;
    this.modelRequirements = {
      structuredOutput: true,
      ...options.modelRequirements,
      ...(this.toolRegistry ? { toolCalls: true } : {}),
    };

    if (
      this.config.provider !== 'openrouter' ||
      !isFreeModel(this.config.model) ||
      !this.config.hasCredential
    ) {
      throw new PublicModelError({
        code: 'CONFIGURATION_MISSING',
        requestId: 'configuration',
        traceId: 'configuration',
      });
    }

    if (this.catalog) {
      const selection = this.catalog.select(this.modelRequirements, this.config.model);
      if (selection.status !== 'selected') {
        throw catalogSelectionError(selection, 'configuration', 'configuration');
      }
    }
  }

  async generateStructured<T>(input: StructuredModelInput<T>): Promise<ModelCallResult<T>> {
    const context = this.createContext(input, 'MODEL_GENERATE');
    const startedAt = Date.now();
    let release: (() => void) | undefined;

    try {
      release = this.acquire(context.requestId, context.traceId);
      const requestContext = this.createRequest(input, context.requestId);
      const response = await timeoutPromise(
        this.runtime.generate(requestContext.request),
        this.limits.timeoutMs,
        requestContext.abort,
      );
      const modelId = this.resolveModelId(response.modelId);
      const parsed = parseOutput(response, input.output.parse);
      this.assertOutputLimit(parsed.text);
      const result = this.result(
        parsed.value,
        parsed.text,
        modelId,
        context.requestId,
        Date.now() - startedAt,
        response.usage,
      );
      await this.writeAudit({
        ...context,
        resultStatus: 'SUCCEEDED',
        modelId,
        durationMs: result.metadata.durationMs ?? 0,
      });
      return result;
    } catch (error) {
      const publicError = this.toPublicError(error, context.requestId, context.traceId, false);
      await this.writeAudit({
        ...context,
        resultStatus: 'FAILED',
        modelId: this.config.model,
        durationMs: Date.now() - startedAt,
        errorCode: publicError.code,
      });
      throw publicError;
    } finally {
      release?.();
    }
  }

  async *streamStructured<T>(
    input: StructuredModelInput<T>,
  ): AsyncGenerator<ModelStreamEvent<T>, void, undefined> {
    const context = this.createContext(input, 'MODEL_STREAM');
    const startedAt = Date.now();
    let release: (() => void) | undefined;
    let outputText = '';
    let structuredValue: unknown;
    let usage: PiAiUsage | undefined;
    let modelId = this.config.model;

    try {
      release = this.acquire(context.requestId, context.traceId);
      if (!this.runtime.stream) {
        throw new Error('streaming is unavailable');
      }
      const requestContext = this.createRequest(input, context.requestId);
      const iterator = this.runtime.stream(requestContext.request)[Symbol.asyncIterator]();
      let done = false;
      while (!done) {
        const next = await timeoutPromise(
          iterator.next(),
          this.limits.timeoutMs,
          requestContext.abort,
        );
        done = next.done === true;
        if (done) break;
        const event = next.value;
        if (event.type === 'error') {
          const runtimeError = Object.assign(new Error('stream failed'), {
            status: event.status,
            code: event.code,
          });
          throw runtimeError;
        }
        if (event.type === 'text_delta') {
          outputText += event.delta;
          this.assertOutputLimit(outputText);
          yield { type: 'text_delta', delta: event.delta };
        } else if (event.type === 'structured_output') {
          structuredValue = event.value;
        } else if (event.type === 'usage') {
          usage = event.usage;
          yield { type: 'usage', usage: event.usage };
        } else if (event.type === 'done') {
          if (event.text !== undefined) outputText = event.text;
          if (event.value !== undefined) structuredValue = event.value;
          if (event.modelId !== undefined) modelId = event.modelId;
        }
      }

      const parsed = parseOutput(
        { text: outputText, structuredOutput: structuredValue },
        input.output.parse,
      );
      this.assertOutputLimit(parsed.text);
      modelId = this.resolveModelId(modelId);
      const result = this.result(
        parsed.value,
        parsed.text,
        modelId,
        context.requestId,
        Date.now() - startedAt,
        usage,
      );
      yield { type: 'structured', value: result.value };
      yield { type: 'done', result };
      await this.writeAudit({
        ...context,
        resultStatus: 'SUCCEEDED',
        modelId,
        durationMs: result.metadata.durationMs ?? 0,
      });
    } catch (error) {
      const publicError = this.toPublicError(error, context.requestId, context.traceId, true);
      await this.writeAudit({
        ...context,
        resultStatus: 'FAILED',
        modelId,
        durationMs: Date.now() - startedAt,
        errorCode: publicError.code,
      });
      throw publicError;
    } finally {
      release?.();
    }
  }

  private createContext<T>(
    input: StructuredModelInput<T>,
    action: SafeModelAuditEvent['action'],
  ): Omit<SafeModelAuditEvent, 'resultStatus' | 'modelId' | 'durationMs' | 'errorCode'> & {
    readonly action: typeof action;
  } {
    const requestId = input.requestId ?? randomUUID();
    return {
      action,
      jobId: input.jobId,
      requestId,
      traceId: input.traceId ?? requestId,
      entityType: this.entityType,
      entityId: input.entityId,
      sourceRecordId: input.sourceRecordId,
      providerId: 'openrouter',
    };
  }

  private createRequest<T>(
    input: StructuredModelInput<T>,
    requestId: string,
  ): { readonly request: PiAiRequest; readonly abort: () => void } {
    const inputLength = input.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (inputLength > this.limits.maxInputChars) {
      throw new PublicModelError({
        code: 'MODEL_OUTPUT_INVALID',
        requestId,
        traceId: requestId,
        retryable: false,
      });
    }

    const controller = new AbortController();
    return {
      request: {
        provider: 'openrouter',
        model: this.config.model,
        baseUrl: this.config.baseUrl,
        requestId,
        messages: redactModelMessages(input.messages as readonly ModelMessageLike[]) as PiAiMessage[],
        responseFormat: {
          name: input.output.name,
          schema: input.output.schema,
        },
        ...(this.toolRegistry ? { tools: this.toolRegistry.listMetadata() } : {}),
        ...(this.modelRequirements.imageOutput ? { outputModalities: ['image'] } : {}),
        signal: controller.signal,
      },
      abort: () => controller.abort(),
    };
  }

  private resolveModelId(actualModelId?: string): string {
    const modelId = actualModelId?.trim() || this.config.model;
    if (!isFreeModel(modelId)) {
      throw new Error('provider returned a non-free model');
    }
    if (this.catalog) {
      const selection = this.catalog.validateActual(modelId, this.modelRequirements);
      if (selection.status !== 'selected') {
        throw new Error('provider returned a model without the requested capabilities');
      }
    }
    return modelId;
  }

  private assertOutputLimit(text: string): void {
    if (text.length > this.limits.maxOutputChars) {
      throw new Error('model output exceeded the configured limit');
    }
  }

  private result<T>(
    value: T,
    text: string,
    modelId: string,
    requestId: string,
    durationMs: number,
    usage?: PiAiUsage,
  ): ModelCallResult<T> {
    return {
      value,
      text,
      usage,
      metadata: { providerId: 'openrouter', modelId, requestId, durationMs },
    };
  }

  private acquire(requestId: string, traceId: string): () => void {
    const now = Date.now();
    while (this.requestTimestamps[0] !== undefined && now - this.requestTimestamps[0] >= 60_000) {
      this.requestTimestamps.shift();
    }
    if (
      this.activeRequests >= this.limits.maxConcurrentRequests ||
      this.requestTimestamps.length >= this.limits.maxRequestsPerMinute
    ) {
      throw new PublicModelError({
        code: 'MODEL_RATE_LIMITED',
        requestId,
        traceId,
      });
    }

    this.activeRequests += 1;
    this.requestTimestamps.push(now);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRequests -= 1;
    };
  }

  private toPublicError(
    error: unknown,
    requestId: string,
    traceId: string,
    streaming: boolean,
  ): PublicModelError {
    if (isPublicModelError(error)) return error;
    if (isRateLimited(error)) {
      return new PublicModelError({ code: 'MODEL_RATE_LIMITED', requestId, traceId });
    }
    if (isTimedOut(error)) {
      return new PublicModelError({
        code: 'MODEL_NOT_AVAILABLE',
        requestId,
        traceId,
        retryable: true,
      });
    }
    if (
      error instanceof Error &&
      (error.message.startsWith('model output') || error.message === 'empty model output')
    ) {
      return new PublicModelError({
        code: 'MODEL_OUTPUT_INVALID',
        requestId,
        traceId,
        retryable: false,
      });
    }
    if (streaming) {
      return new PublicModelError({
        code: 'MODEL_NOT_AVAILABLE',
        requestId,
        traceId,
        retryable: true,
      });
    }
    return new PublicModelError({
      code: 'MODEL_NOT_AVAILABLE',
      requestId,
      traceId,
      retryable: true,
    });
  }

  private async writeAudit(event: SafeModelAuditEvent): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record(event);
    } catch {
      // Audit failure must not expose an infrastructure error or credentials.
      // The model result/error remains governed by the adapter's public contract.
    }
  }
}
