import 'server-only';

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export const XIAOHONGSHU_HOST = 'www.xiaohongshu.com';
export const XIAOHONGSHU_NOTE_PATH = /^\/explore\/([^/?#]+)$/;
export const ALLOWED_NOTE_QUERY_KEYS = new Set(['xsec_token', 'xsec_source']);

export type NoteUrlPolicy = Readonly<{
  maxRedirects: number;
  maxResponseBytes: number;
  timeoutMs: number;
}>;

export const DEFAULT_NOTE_URL_POLICY: NoteUrlPolicy = {
  maxRedirects: 0,
  maxResponseBytes: 2_000_000,
  timeoutMs: 15_000,
};

export type NormalizedOfficialNoteUrl = Readonly<{
  raw: string;
  normalized: string;
  hostname: typeof XIAOHONGSHU_HOST;
  pathname: string;
}>;

export class NoteUrlSecurityError extends Error {
  readonly code = 'NOTE_URL_FORBIDDEN';
  constructor(message: string) {
    super(message);
    this.name = 'NoteUrlSecurityError';
  }
}

function reject(message: string): never {
  throw new NoteUrlSecurityError(message);
}

function safeQuery(url: URL): string {
  const entries = [...url.searchParams.entries()];
  for (const [key, value] of entries) {
    if (!ALLOWED_NOTE_QUERY_KEYS.has(key) || !value || value.length > 512) {
      reject('The Note_URL contains an unsupported query parameter.');
    }
  }
  const sorted = entries.sort(([left], [right]) => left.localeCompare(right));
  return sorted.length ? `?${new URLSearchParams(sorted).toString()}` : '';
}

export function normalizeOfficialNoteUrl(value: unknown): NormalizedOfficialNoteUrl {
  if (typeof value !== 'string' || !value.trim()) reject('A Note_URL is required.');
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject('Provide a valid HTTPS Xiaohongshu Note_URL.');
  }
  const authority = raw.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== XIAOHONGSHU_HOST ||
    url.port ||
    /:\d+$/.test(authority) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    reject('Only the official HTTPS Xiaohongshu host without credentials, ports, or fragments is accepted.');
  }
  const match = url.pathname.replace(/\/+$/, '').match(XIAOHONGSHU_NOTE_PATH);
  if (!match || !match[1]) reject('Use an official Xiaohongshu /explore/{note-id} URL.');
  const pathname = `/explore/${match[1]}`;
  return {
    raw,
    normalized: `https://${XIAOHONGSHU_HOST}${pathname}${safeQuery(url)}`,
    hostname: XIAOHONGSHU_HOST,
    pathname,
  };
}

export type DnsLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

const PRIVATE_IPV4_RANGES = [
  [0x00000000, 0x000000ff],
  [0x0a000000, 0x0affffff],
  [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0000200, 0xc00002ff],
  [0xc6336400, 0xc63364ff],
  [0xcb007100, 0xcb0071ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xe0000000, 0xffffffff],
] as const;

function ipv4Number(value: string): number | undefined {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return undefined;
  return parts.reduce((result, part) => result * 256 + Number(part), 0) >>> 0;
}

export function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return value === undefined || PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
  }
  if (family !== 6) return true;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateOrReservedIp(mapped[1]) : false;
}

export async function assertSafeGatewayUrl(value: string, lookup: DnsLookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true });
  return results.map(({ address, family }) => ({ address, family }));
}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    reject('The OpenCLI gateway URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) reject('The OpenCLI gateway must be an HTTPS URL without credentials, query, or fragment.');
  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname);
  } catch {
    reject('The OpenCLI gateway hostname could not be safely resolved.');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedIp(address))) reject('The OpenCLI gateway resolves to a private or reserved address.');
  return url;
}

export function assertSafeRedirect(location: string, current: NormalizedOfficialNoteUrl): NormalizedOfficialNoteUrl {
  let target: URL;
  try {
    target = new URL(location, current.normalized);
  } catch {
    reject('The gateway returned an invalid redirect.');
  }
  const normalized = normalizeOfficialNoteUrl(target.toString());
  if (normalized.normalized !== current.normalized) {
    reject('Gateway redirects are not permitted.');
  }
  return normalized;
}

export function assertNoteUrlPolicy(policy: NoteUrlPolicy = DEFAULT_NOTE_URL_POLICY): NoteUrlPolicy {
  if (!Number.isSafeInteger(policy.maxRedirects) || policy.maxRedirects < 0 || policy.maxRedirects > 0) reject('Redirects are not permitted.');
  if (!Number.isSafeInteger(policy.maxResponseBytes) || policy.maxResponseBytes < 1 || policy.maxResponseBytes > 10_000_000) reject('The gateway response limit is invalid.');
  if (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 30_000) reject('The gateway execution limit is invalid.');
  return policy;
}

export function assertGatewayResponseSize(size: number, policy: NoteUrlPolicy = DEFAULT_NOTE_URL_POLICY): void {
  assertNoteUrlPolicy(policy);
  if (!Number.isSafeInteger(size) || size < 0 || size > policy.maxResponseBytes) reject('The gateway response exceeded the permitted size.');
}

export function assertGatewayRedirectCount(count: number, policy: NoteUrlPolicy = DEFAULT_NOTE_URL_POLICY): void {
  assertNoteUrlPolicy(policy);
  if (!Number.isSafeInteger(count) || count < 0 || count > policy.maxRedirects) reject('The gateway returned a disallowed redirect.');
}

export function assertGatewayElapsedTime(elapsedMs: number, policy: NoteUrlPolicy = DEFAULT_NOTE_URL_POLICY): void {
  assertNoteUrlPolicy(policy);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > policy.timeoutMs) reject('The gateway execution exceeded the permitted time.');
}
