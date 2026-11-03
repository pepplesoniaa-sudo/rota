import { withApi } from '@/lib/api';
import { getBillingOverview } from '@/lib/domain/billing/overview';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: [Role.OWNER],
  },
  async ({ params }) => {
    const { teamId } = params as { teamId: string };
    return getBillingOverview(teamId);
  },
);
