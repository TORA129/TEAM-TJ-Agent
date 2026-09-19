import 'server-only';

import { withOperatorRoute, type RouteProtectionOptions } from '@/server/http/route-protection';
import { PublicApplicationError } from '@/server/public-errors';
import { getConfiguredJobService } from './runtime';
import { JobService } from './service';

export type JobRouteContext = {
  readonly params?: { readonly jobId?: unknown } | Promise<{ readonly jobId?: unknown }>;
};

export function createJobGetHandler(
  service?: JobService,
  options: RouteProtectionOptions = {},
) {
  return withOperatorRoute(
    async (_request, context, routeContext) => {
      const jobId = await readJobId(routeContext as JobRouteContext | undefined);
      const jobService = service ?? getConfiguredJobService();
      const status = await jobService.getStatus({
        jobId,
        operatorId: context.operator.operatorId,
      });
      return Response.json(status, { headers: { 'cache-control': 'no-store' } });
    },
    options,
  );
}

async function readJobId(routeContext: JobRouteContext | undefined): Promise<string> {
  const params = routeContext?.params ? await routeContext.params : undefined;
  if (!params || typeof params.jobId !== 'string') {
    throw new PublicApplicationError({
      code: 'VALIDATION_FAILED',
      fieldErrors: { jobId: ['A job identifier is required.'] },
    });
  }
  return params.jobId;
}
