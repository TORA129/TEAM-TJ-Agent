import { createInsightListGetHandler, createInsightReferencesGetHandler } from '@/server/review/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createInsightListGetHandler();
export const POST = createInsightReferencesGetHandler();
