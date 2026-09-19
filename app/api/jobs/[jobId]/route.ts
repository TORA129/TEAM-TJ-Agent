import { createJobGetHandler } from '@/server/jobs/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createJobGetHandler();
