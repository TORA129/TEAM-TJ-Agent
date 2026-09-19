import { createReviewFetchPostHandler } from '@/server/review/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createReviewFetchPostHandler();
