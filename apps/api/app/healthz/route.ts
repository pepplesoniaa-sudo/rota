import { withApi } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'public',
  },
  async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  },
);
