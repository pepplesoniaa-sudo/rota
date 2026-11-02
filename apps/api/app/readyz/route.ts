import { withApi } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'public',
  },
  async () => {
    // Check connections (e.g. database / redis when active)
    return { status: 'ready', timestamp: new Date().toISOString() };
  },
);
