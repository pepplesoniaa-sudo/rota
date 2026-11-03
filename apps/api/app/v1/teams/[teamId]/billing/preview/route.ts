import { withApi } from '@/lib/api';
import { previewPlanChange } from '@/lib/domain/billing/plan';
import { changePlanBodySchema, ChangePlanBody } from '@rota/shared';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: [Role.OWNER],
    body: changePlanBodySchema,
  },
  async ({ params, body }) => {
    const { teamId } = params as { teamId: string };
    const { plan } = body as ChangePlanBody;
    return previewPlanChange(teamId, plan);
  },
);
