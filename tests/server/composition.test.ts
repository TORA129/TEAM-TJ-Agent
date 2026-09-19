import { describe, expect, it } from 'vitest';
import type { PersistenceRepositories } from '../../domain/persistence/repositories';
import { configureServerServices } from '../../server/composition';
import { getConfiguredCopywriterService, getConfiguredCoverService, getConfiguredSupplementaryFileService } from '../../server/copywriter/runtime';
import { getConfiguredJobService } from '../../server/jobs/runtime';
import { getConfiguredReviewService } from '../../server/review/runtime';
import { getConfiguredReviewInsightService } from '../../server/review/insight-runtime';
import { getConfiguredReviewMetricsService } from '../../server/review/metrics-runtime';
import { getConfiguredBlockedTermListService } from '../../server/settings/blocked-terms-runtime';

function dependencies() {
  return {
    repositories: {} as PersistenceRepositories,
    assetStorage: {} as never,
    privateObjectStorage: {} as never,
    coverImage: {} as never,
  };
}

describe('server composition', () => {
  it('registers every route service from the supplied provider-neutral boundaries', () => {
    const services = configureServerServices(dependencies());

    expect(getConfiguredJobService()).toBe(services.jobs);
    expect(getConfiguredCopywriterService()).toBe(services.copywriter);
    expect(getConfiguredSupplementaryFileService()).toBe(services.supplementaryFiles);
    expect(getConfiguredCoverService()).toBe(services.cover);
    expect(getConfiguredReviewService()).toBe(services.review);
    expect(getConfiguredReviewMetricsService()).toBe(services.metrics);
    expect(getConfiguredReviewInsightService()).toBe(services.insights);
    expect(getConfiguredBlockedTermListService()).toBe(services.blockedTerms);
  });
});
