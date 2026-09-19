import { createReviewMetricsGetHandler, createReviewMetricsPatchHandler } from '@/server/review/metrics-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createReviewMetricsGetHandler();
export const PATCH = createReviewMetricsPatchHandler();
