import 'server-only';

export const DEFAULT_SESSION_COOKIE_NAME = 'team_tj_session';
const MAX_SESSION_TOKEN_LENGTH = 512;
const MAX_IDENTIFIER_LENGTH = 128;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type OperatorRole = 'OPERATOR' | 'ADMIN';

/**
 * A session returned by a trusted server-side session store. The cookie only
 * carries the opaque token; operator identity and CSRF material come from the
 * store and are never accepted from request JSON or query parameters.
 */
export interface TrustedOperatorSession {
  readonly sessionId: string;
  readonly operatorId: string;
  readonly roles: readonly OperatorRole[];
  readonly csrfToken: string;
  readonly expiresAt?: Date;
}

export interface TrustedSessionStore {
  lookupByToken(token: string): Promise<TrustedOperatorSession | null>;
}

export type TrustedSessionResolver = (request: Request) => Promise<TrustedOperatorSession | null>;

const failClosedSessionStore: TrustedSessionStore = {
  async lookupByToken() {
    return null;
  },
};

function readOpaqueCookie(request: Request, cookieName: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  let token: string | null = null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    if (token !== null) return null;
    token = part.slice(separator + 1).trim();
  }

  if (!token || token.length > MAX_SESSION_TOKEN_LENGTH) return null;

  try {
    const decoded = decodeURIComponent(token);
    return decoded.length > 0 && decoded.length <= MAX_SESSION_TOKEN_LENGTH ? decoded : null;
  } catch {
    return null;
  }
}

function isValidIdentifier(value: string): boolean {
  return value.length <= MAX_IDENTIFIER_LENGTH && SAFE_IDENTIFIER_PATTERN.test(value);
}

function isValidRole(value: unknown): value is OperatorRole {
  return value === 'OPERATOR' || value === 'ADMIN';
}

function isLiveSession(session: TrustedOperatorSession): boolean {
  return (
    isValidIdentifier(session.sessionId) &&
    isValidIdentifier(session.operatorId) &&
    session.roles.length > 0 &&
    session.roles.every(isValidRole) &&
    session.csrfToken.length > 0 &&
    session.csrfToken.length <= MAX_SESSION_TOKEN_LENGTH &&
    (session.expiresAt === undefined || session.expiresAt.getTime() > Date.now())
  );
}

export function createTrustedSessionResolver(
  store: TrustedSessionStore,
  options: { readonly cookieName?: string } = {},
): TrustedSessionResolver {
  const cookieName = options.cookieName ?? DEFAULT_SESSION_COOKIE_NAME;

  return async (request) => {
    const token = readOpaqueCookie(request, cookieName);
    if (!token) return null;

    const session = await store.lookupByToken(token);
    return session && isLiveSession(session) ? session : null;
  };
}

/**
 * Default behavior deliberately fails closed until the deployment wires a
 * real server-side identity provider. This makes an unconfigured preview
 * unable to authorize itself from client-controlled fields.
 */
export const resolveTrustedOperatorSession = createTrustedSessionResolver(failClosedSessionStore);

export type PublicOperatorSession = {
  readonly authenticated: true;
  readonly operator: {
    readonly id: string;
    readonly roles: readonly OperatorRole[];
  };
  readonly session: {
    readonly id: string;
    readonly expiresAt?: string;
  };
};

export function toPublicOperatorSession(session: TrustedOperatorSession): PublicOperatorSession {
  return {
    authenticated: true,
    operator: { id: session.operatorId, roles: [...session.roles] },
    session: {
      id: session.sessionId,
      ...(session.expiresAt ? { expiresAt: session.expiresAt.toISOString() } : {}),
    },
  };
}
