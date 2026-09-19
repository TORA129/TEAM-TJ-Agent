import { safeJsonResponse } from '@/server/security/safe-dtos';
import { getConfigurationStatus } from '@/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return safeJsonResponse(getConfigurationStatus());
}
