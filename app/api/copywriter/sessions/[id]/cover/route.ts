import { createCopywriterCoverGetHandler, createCopywriterCoverPatchHandler } from '@/server/copywriter/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createCopywriterCoverGetHandler();
export const PATCH = createCopywriterCoverPatchHandler();
