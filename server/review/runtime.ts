import { PublicApplicationError } from '@/server/public-errors';
import { ReviewService } from './service';

let configured: ReviewService | undefined;
export function configureReviewService(service: ReviewService): void { configured = service; }
export function getConfiguredReviewService(): ReviewService { if (!configured) throw new PublicApplicationError({ code: 'CONFIGURATION_MISSING' }); return configured; }
