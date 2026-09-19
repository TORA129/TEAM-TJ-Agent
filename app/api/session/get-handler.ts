import { toPublicOperatorSession, type TrustedSessionResolver } from '@/server/auth/session';
import { withOperatorRoute, type RouteProtectionOptions } from '@/server/http/route-protection';

export function createSessionGetHandler(
  options: RouteProtectionOptions & { readonly resolveSession: TrustedSessionResolver },
) {
  return withOperatorRoute((_request, context) => {
    return Response.json(toPublicOperatorSession(context.session));
  }, options);
}
