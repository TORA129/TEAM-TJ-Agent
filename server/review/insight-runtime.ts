import { PublicApplicationError } from '@/server/public-errors';
import { ReviewInsightService } from './insight-service';

let configured: ReviewInsightService | undefined;
export function configureReviewInsightService(service: ReviewInsightService): void { configured = service; }
export function getConfiguredReviewInsightService(): ReviewInsightService {
  if (!configured) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' });
  return configured;
}
