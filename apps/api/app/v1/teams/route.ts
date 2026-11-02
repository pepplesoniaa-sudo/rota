import { AppError, CreateTeamBody } from '@rota/shared';
import { withApi } from '../../../lib/api/with-api';
import { createTeam } from '../../../lib/domain/teams/create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/teams (FR-07, PRD 7.2, SEC-1, B-8)
 * Creates a new team, assigns owner role, allocates shard, and starts 14-day trial.
 */
export const POST = withApi(
  {
    auth: 'access',
    status: 201,
    body: CreateTeamBody,
  },
  async ({ body, userId }) => {
    if (!userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return createTeam(body, userId);
  },
);

