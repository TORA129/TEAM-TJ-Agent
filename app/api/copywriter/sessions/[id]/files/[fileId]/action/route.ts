import { createSupplementaryFileActionHandler } from '@/server/copywriter/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createSupplementaryFileActionHandler();
