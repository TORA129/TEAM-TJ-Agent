import 'server-only';

import { PublicApplicationError } from '@/server/public-errors';
import { BlockedTermListService } from './blocked-terms-service';

let configuredService: BlockedTermListService | undefined;

export function configureBlockedTermListService(service: BlockedTermListService): void {
  configuredService = service;
}

export function getConfiguredBlockedTermListService(): BlockedTermListService {
  if (!configuredService) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });
  return configuredService;
}
