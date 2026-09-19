import { createReviewThresholdsGetHandler, createReviewThresholdsPatchHandler } from '@/server/review/metrics-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createReviewThresholdsGetHandler();
export const PATCH = createReviewThresholdsPatchHandler();
