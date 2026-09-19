import {
  createCopywriterSessionGetHandler,
  createCopywriterSessionPatchHandler,
} from '@/server/copywriter/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createCopywriterSessionGetHandler();
export const PATCH = createCopywriterSessionPatchHandler();
