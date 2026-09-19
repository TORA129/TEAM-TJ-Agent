import { createReviewEvaluationPostHandler } from '@/server/review/metrics-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createReviewEvaluationPostHandler();
