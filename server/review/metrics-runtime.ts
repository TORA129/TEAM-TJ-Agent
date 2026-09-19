import { PublicApplicationError } from '@/server/public-errors';
import type { ReviewMetricsService } from './metrics-service';
let configured: ReviewMetricsService | undefined;
export function configureReviewMetricsService(service: ReviewMetricsService): void { configured = service; }
export function getConfiguredReviewMetricsService(): ReviewMetricsService { if (!configured) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' }); return configured; }
