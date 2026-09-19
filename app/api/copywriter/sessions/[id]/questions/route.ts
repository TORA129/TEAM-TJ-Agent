import { createCopywriterQuestionsPostHandler } from '@/server/copywriter/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createCopywriterQuestionsPostHandler();
