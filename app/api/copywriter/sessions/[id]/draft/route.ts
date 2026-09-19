import {
  createCopywriterDraftGetHandler,
  createCopywriterDraftPatchHandler,
} from '@/server/copywriter/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createCopywriterDraftGetHandler();
export const PATCH = createCopywriterDraftPatchHandler();
