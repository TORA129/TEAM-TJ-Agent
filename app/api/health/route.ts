export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVICE_NAME = 'team-tj-xiaohongshu-ai-agent';
const SERVICE_VERSION = '0.1.0';

export function GET() {
  return Response.json({
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
  });
}
