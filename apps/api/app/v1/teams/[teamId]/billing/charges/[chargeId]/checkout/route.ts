import { withApi } from '@/lib/api';
import { createChargeCheckout } from '@/lib/domain/billing/checkout';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: [Role.OWNER],
  },
  async ({ params }) => {
    const { teamId, chargeId } = params as { teamId: string; chargeId: string };
    return createChargeCheckout(teamId, chargeId);
  },
);
