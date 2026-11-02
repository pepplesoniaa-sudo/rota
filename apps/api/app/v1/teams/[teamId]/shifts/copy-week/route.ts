import { AppError, CopyWeekBody } from '@rota/shared';
import { withApi } from '../../../../../../lib/api/with-api';
import { copyWeek } from '../../../../../../lib/domain/shifts/publish-copy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    status: 200,
    body: CopyWeekBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }

    return copyWeek({
      teamId: ctx.teamId,
      createdByUserId: ctx.userId,
      body: ctx.body,
    });
  },
);
