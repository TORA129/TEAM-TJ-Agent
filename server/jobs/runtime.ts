import 'server-only';

import { JobService } from './service';
import { PublicApplicationError } from '@/server/public-errors';

let configuredJobService: JobService | undefined;

/**
 * Production composition should configure this with a durable JobRepository
 * backed service. Failing closed keeps an unconfigured preview from claiming
 * that an in-memory process is a persistent job runner.
 */
export function configureJobService(service: JobService): void {
  configuredJobService = service;
}

export function getConfiguredJobService(): JobService {
  if (!configuredJobService) {
    throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });
  }
  return configuredJobService;
}
