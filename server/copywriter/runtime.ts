import 'server-only';

import { PublicApplicationError } from '@/server/public-errors';
import { CopywriterService } from './service';
import { SupplementaryFileService } from './supplementary-files';

let configuredCopywriterService: CopywriterService | undefined;

export function configureCopywriterService(service: CopywriterService): void {
  configuredCopywriterService = service;
}

export function getConfiguredCopywriterService(): CopywriterService {
  if (!configuredCopywriterService) {
    throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });
  }
  return configuredCopywriterService;
}

let configuredSupplementaryFileService: SupplementaryFileService | undefined;

export function configureSupplementaryFileService(service: SupplementaryFileService): void {
  configuredSupplementaryFileService = service;
}

export function getConfiguredSupplementaryFileService(): SupplementaryFileService {
  if (!configuredSupplementaryFileService) {
    throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });
  }
  return configuredSupplementaryFileService;
}

import { CoverService } from './cover-service';
let configuredCoverService: CoverService | undefined;
export function configureCoverService(service: CoverService): void { configuredCoverService = service; }
export function getConfiguredCoverService(): CoverService { if (!configuredCoverService) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' }); return configuredCoverService; }
