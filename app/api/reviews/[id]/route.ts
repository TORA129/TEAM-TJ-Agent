import { createAuthorizationPatchHandler, createReviewGetHandler } from '@/server/review/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createReviewGetHandler();
export const PATCH = createAuthorizationPatchHandler();
