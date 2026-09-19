import { safeJsonResponse } from '@/server/security/safe-dtos';
import { withOperatorRoute } from '@/server/http/route-protection';
import { toPublicOperatorSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withOperatorRoute((_request, context) => {
  return safeJsonResponse(toPublicOperatorSession(context.session));
});
