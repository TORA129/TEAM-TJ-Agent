import 'server-only';

import { RouteGuardError } from './errors';

export type RequestLimits = {
  readonly maxBodyBytes: number;
  readonly maxJsonBytes: number;
  readonly maxFormBytes: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxFormFields: number;
  readonly allowedFileMimeTypes?: readonly string[];
};

export const DEFAULT_REQUEST_LIMITS: RequestLimits = {
  maxBodyBytes: 10_485_760,
  maxJsonBytes: 1_048_576,
  maxFormBytes: 10_485_760,
  maxFileBytes: 5_242_880,
  maxFiles: 5,
  maxFormFields: 50,
};

function contentType(request: Request): string | null {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || null;
}

function contentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  if (!/^\d+$/.test(raw.trim())) {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_INVALID',
      message: 'The request could not be parsed.',
      action: 'Send a valid Content-Length header or omit it.',
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_INVALID',
      message: 'The request could not be parsed.',
      action: 'Send a valid Content-Length header or omit it.',
    });
  }
  return value;
}

function hasBody(request: Request): boolean {
  const length = contentLength(request);
  return (length !== null && length > 0) || request.body !== null;
}

function throwBodyTooLarge(): never {
  throw new RouteGuardError({
    status: 413,
    code: 'REQUEST_BODY_TOO_LARGE',
    message: 'The request body is too large.',
    action: 'Reduce the request or uploaded file size and try again.',
  });
}

function ensureByteLimit(size: number, limit: number): void {
  if (!Number.isSafeInteger(size) || size > limit) throwBodyTooLarge();
}

export function assertRequestBodyPreflight(
  request: Request,
  limits: RequestLimits = DEFAULT_REQUEST_LIMITS,
): { readonly contentType: string | null; readonly contentLength: number | null } {
  const length = contentLength(request);
  const type = contentType(request);
  if (length !== null) ensureByteLimit(length, limits.maxBodyBytes);

  if (!hasBody(request)) return { contentType: type, contentLength: length };
  if (!type || (type !== 'application/json' && type !== 'multipart/form-data')) {
    throw new RouteGuardError({
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The request content type is not supported.',
      action: 'Use application/json or multipart/form-data.',
    });
  }

  if (type === 'application/json' && length !== null) ensureByteLimit(length, limits.maxJsonBytes);
  if (type === 'multipart/form-data' && length !== null) {
    ensureByteLimit(length, limits.maxFormBytes);
  }
  return { contentType: type, contentLength: length };
}

async function readBytes(request: Request, limit: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  ensureByteLimit(bytes.byteLength, limit);
  return bytes;
}

export async function readJsonBody<T = unknown>(
  request: Request,
  limits: RequestLimits = DEFAULT_REQUEST_LIMITS,
): Promise<T> {
  const preflight = assertRequestBodyPreflight(request, limits);
  if (preflight.contentType !== 'application/json') {
    throw new RouteGuardError({
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The request content type is not supported.',
      action: 'Use application/json for this endpoint.',
    });
  }

  const bytes = await readBytes(request, limits.maxJsonBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_INVALID',
      message: 'The request body is not valid JSON.',
      action: 'Correct the JSON body and try again.',
    });
  }
}

function isFileLike(value: FormDataEntryValue): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'size' in value &&
    'name' in value &&
    'type' in value
  );
}

function validateFormDataLimits(formData: FormData, limits: RequestLimits): void {
  let totalBytes = 0;
  let fileCount = 0;
  let fieldCount = 0;
  for (const [, value] of formData.entries()) {
    fieldCount += 1;
    if (fieldCount > limits.maxFormFields) {
      throw new RouteGuardError({
        status: 413,
        code: 'REQUEST_BODY_TOO_LARGE',
        message: 'The multipart request contains too many fields.',
        action: 'Reduce the number of uploaded fields and try again.',
      });
    }
    if (isFileLike(value)) {
      fileCount += 1;
      if (fileCount > limits.maxFiles || value.size > limits.maxFileBytes) throwBodyTooLarge();
      if (
        limits.allowedFileMimeTypes &&
        !limits.allowedFileMimeTypes.includes(value.type.toLowerCase())
      ) {
        throw new RouteGuardError({
          status: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'The uploaded file type is not supported.',
          action: 'Upload an allowed file type.',
        });
      }
      totalBytes += value.size;
    } else {
      totalBytes += new TextEncoder().encode(value).byteLength;
    }
  }
  ensureByteLimit(totalBytes, limits.maxFormBytes);
}

async function parseFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new RouteGuardError({
      status: 400,
      code: 'REQUEST_INVALID',
      message: 'The multipart request could not be parsed.',
      action: 'Check the multipart form and try again.',
    });
  }
}

/**
 * Checks the actual stream on a clone so the eventual Route Handler can still
 * consume the original body. Content-Length is only an early rejection hint;
 * this check also protects chunked requests that omit it.
 */
export async function assertRequestBodyLimits(
  request: Request,
  limits: RequestLimits = DEFAULT_REQUEST_LIMITS,
): Promise<void> {
  const preflight = assertRequestBodyPreflight(request, limits);
  if (!preflight.contentType || !hasBody(request)) return;

  const bytes = new Uint8Array(await request.clone().arrayBuffer());
  ensureByteLimit(bytes.byteLength, limits.maxBodyBytes);
  if (preflight.contentType === 'application/json') {
    ensureByteLimit(bytes.byteLength, limits.maxJsonBytes);
    return;
  }

  ensureByteLimit(bytes.byteLength, limits.maxFormBytes);
  const formData = await parseFormData(request.clone());
  validateFormDataLimits(formData, limits);
}

export async function readFormDataBody(
  request: Request,
  limits: RequestLimits = DEFAULT_REQUEST_LIMITS,
): Promise<FormData> {
  const preflight = assertRequestBodyPreflight(request, limits);
  if (preflight.contentType !== 'multipart/form-data') {
    throw new RouteGuardError({
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The request content type is not supported.',
      action: 'Use multipart/form-data for this endpoint.',
    });
  }

  const formData = await parseFormData(request);
  validateFormDataLimits(formData, limits);
  return formData;
}
