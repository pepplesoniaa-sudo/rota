import { withApi } from '@/lib/api';
import { cancelScheduledPlanChange } from '@/lib/domain/billing/plan';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withApi(
  {
    auth: 'access',
    roles: [Role.OWNER],
  },
  async ({ params }) => {
    const { teamId } = params as { teamId: string };
    return cancelScheduledPlanChange(teamId);
  },
);
