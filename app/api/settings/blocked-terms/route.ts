import {
  createBlockedTermListGetHandler,
  createBlockedTermListPostHandler,
} from '@/server/settings/blocked-terms-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createBlockedTermListGetHandler();
export const POST = createBlockedTermListPostHandler();
