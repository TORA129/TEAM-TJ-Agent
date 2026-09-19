import {
  createSupplementaryFileGetHandler,
  createSupplementaryFilePostHandler,
} from '@/server/copywriter/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createSupplementaryFileGetHandler();
export const POST = createSupplementaryFilePostHandler();
