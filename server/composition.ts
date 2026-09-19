import 'server-only';

import type { AssetStorageService } from '@/adapters/object-storage/asset-storage-service';
import type { PrivateObjectStorageAdapter } from '@/adapters/object-storage/private-object-storage';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import { CopywriterService } from './copywriter/service';
import { CoverService } from './copywriter/cover-service';
import { SupplementaryFileService } from './copywriter/supplementary-files';
import {
  configureCopywriterService,
  configureCoverService,
  configureSupplementaryFileService,
} from './copywriter/runtime';
import { JobService } from './jobs/service';
import { configureJobService } from './jobs/runtime';
import { ReviewService } from './review/service';
import { ReviewMetricsService } from './review/metrics-service';
import { ReviewInsightService } from './review/insight-service';
import { configureReviewService } from './review/runtime';
import { configureReviewMetricsService } from './review/metrics-runtime';
import { configureReviewInsightService } from './review/insight-runtime';
import type { OpenCliGatewayAdapter } from './review/opencli-gateway';
import type { CoverImageAdapter } from './copywriter/cover-image';
import type { PiAiModelAdapter } from './pi-ai-model-adapter';
import { BlockedTermListService } from './settings/blocked-terms-service';
import { configureBlockedTermListService } from './settings/blocked-terms-runtime';

/**
 * Provider-neutral server composition inputs. Deployment code supplies durable
 * repositories and server-only adapters; this module never invents persistence
 * or stores credentials in route handlers.
 */
export type ServerCompositionDependencies = Readonly<{
  repositories: PersistenceRepositories;
  assetStorage: AssetStorageService;
  privateObjectStorage: PrivateObjectStorageAdapter;
  coverImage: CoverImageAdapter;
  model?: PiAiModelAdapter;
  gateway?: OpenCliGatewayAdapter;
  now?: () => Date;
}>;

export type ConfiguredServerServices = Readonly<{
  jobs: JobService;
  copywriter: CopywriterService;
  supplementaryFiles: SupplementaryFileService;
  cover: CoverService;
  review: ReviewService;
  metrics: ReviewMetricsService;
  insights: ReviewInsightService;
  blockedTerms: BlockedTermListService;
}>;

/**
 * Registers the complete Route Handler runtime graph in one place.
 * Calling this is the only supported production wiring path; callers must
 * provide real provider implementations rather than test doubles or disk IO.
 */
export function configureServerServices(
  dependencies: ServerCompositionDependencies,
): ConfiguredServerServices {
  const { repositories, now } = dependencies;
  const jobs = new JobService(repositories.jobs, { now });
  const copywriter = new CopywriterService(repositories, { now, model: dependencies.model });
  const supplementaryFiles = new SupplementaryFileService(repositories, dependencies.privateObjectStorage, { now });
  const cover = new CoverService(
    repositories,
    dependencies.assetStorage,
    dependencies.coverImage,
    now ?? (() => new Date()),
  );
  const review = new ReviewService(repositories, { now, jobService: jobs, gateway: dependencies.gateway });
  const metrics = new ReviewMetricsService(repositories, now);
  const insights = new ReviewInsightService(repositories, { now });
  const blockedTerms = new BlockedTermListService(repositories);

  configureJobService(jobs);
  configureCopywriterService(copywriter);
  configureSupplementaryFileService(supplementaryFiles);
  configureCoverService(cover);
  configureReviewService(review);
  configureReviewMetricsService(metrics);
  configureReviewInsightService(insights);
  configureBlockedTermListService(blockedTerms);

  return { jobs, copywriter, supplementaryFiles, cover, review, metrics, insights, blockedTerms };
}
