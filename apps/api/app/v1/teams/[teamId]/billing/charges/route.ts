import { withApi } from '@/lib/api';
import { listCharges } from '@/lib/domain/billing/charges';
import { cursorQuerySchema, CursorQuery } from '@rota/shared';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: [Role.OWNER],
    query: cursorQuerySchema,
  },
  async ({ params, query }) => {
    const { teamId } = params as { teamId: string };
    return listCharges(teamId, query as CursorQuery);
  },
);
