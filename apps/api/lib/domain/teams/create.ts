import { CreateTeamBody, TeamResponse } from '@rota/shared';
import { DateTime } from 'luxon';
import { v7 as uuidv7 } from 'uuid';
import { createLedgerEntry } from '../../billing/ledger';
import { computeShardIndex, markUserWrite } from '../../data/router';
import { dbShard0 } from '../../db';
import { dispatchOutboxEntry, writeOutbox } from '../../outbox/writer';
import { redis } from '../../redis';

/**
 * Creates a new team (FR-07, PRD 7.2, PRD 7.6, B-8).
 * - Generates UUID v7 team ID in the API before write (L-28)
 * - Shard index computed deterministically by hash(teamId) % 2 (L-28, A-7, PRD 7.6)
 * - Creator assigned as OWNER (FR-07, B-22)
 * - Starts Starter plan with 14-day trial (first charge due in 14 days) (FR-07, B-8)
 * - Writes CHARGE_SUBSCRIPTION ledger entry for the plan price ($20.00 / 2000c) (MB-8, MB-9, PRD 8.7)
 * - Writes feed.append Outbox entry for member joined on shard (A-5, A-6, PRD 7.6)
 * - Warms team shard and permission caches in Redis (L-32)
 * - Triggers RYOW for user (PRD 7.5, AGENTS.md A-9)
 */
export async function createTeam(input: CreateTeamBody, userId: string): Promise<TeamResponse> {
  const teamId = uuidv7();
  const shardIndex = computeShardIndex(teamId);

  // Current period starts at creation, truncated to the second (PRD 8.2)
  const now = new Date();
  const currentPeriodStart = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const startDateTime = DateTime.fromJSDate(currentPeriodStart, { zone: 'utc' });
  const anchorDay = startDateTime.day;
  const currentPeriodEnd = startDateTime.plus({ months: 1 }).toJSDate();

  // 14-day trial: first charge due 14 days after creation (FR-07, B-8)
  const trialEndsAt = new Date(currentPeriodStart.getTime() + 14 * 24 * 60 * 60 * 1000);
  const STARTER_PRICE_CENTS = 2000;

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const { team, outboxEntry } = await client.$transaction(async (tx) => {
    // 1. Create team on Shard 0
    const newTeam = await tx.team.create({
      data: {
        id: teamId,
        name: input.name,
        timezone: input.timezone,
        shardIndex,
        weekStartsOn: input.weekStartsOn ?? 1,
        ownerUserId: userId,
        createdAt: currentPeriodStart,
      },
    });

    // 2. Creator becomes OWNER (B-22)
    const membership = await tx.membership.create({
      data: {
        teamId: newTeam.id,
        userId,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: currentPeriodStart,
      },
    });

    // 3. Start Starter subscription (B-8, FR-07)
    const subscription = await tx.subscription.create({
      data: {
        teamId: newTeam.id,
        plan: 'STARTER',
        status: 'ACTIVE',
        anchorDay,
        currentPeriodStart,
        currentPeriodEnd,
        paidSeats: 1, // 1 active seat (the owner)
        version: 1,
      },
    });

    // 4. Create first charge with dueAt 14 days later (trial period) (FR-07, B-8)
    const chargeId = uuidv7();
    const charge = await tx.charge.create({
      data: {
        id: chargeId,
        teamId: newTeam.id,
        subscriptionId: subscription.id,
        kind: 'SUBSCRIPTION',
        status: 'PENDING',
        amountCents: STARTER_PRICE_CENTS,
        currency: 'USD',
        idempotencyKey: `renew:${subscription.id}:${startDateTime.toISO()}`,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        lineItems: [
          {
            label: 'Starter plan (up to 5 seats)',
            amountCents: STARTER_PRICE_CENTS,
          },
        ],
        dueAt: trialEndsAt,
      },
    });

    // 5. Append CHARGE_SUBSCRIPTION ledger entry (MB-8, MB-9, PRD 8.7, decisions.md)
    await createLedgerEntry(tx, {
      teamId: newTeam.id,
      chargeId: charge.id,
      type: 'CHARGE_SUBSCRIPTION',
      amountCents: STARTER_PRICE_CENTS,
      currency: 'USD',
      idempotencyKey: `charge:${charge.id}`,
      description: 'Starter subscription (14-day trial)',
      metadata: {
        plan: 'STARTER',
        seats: 1,
        trialEndsAt: trialEndsAt.toISOString(),
      },
      occurredAt: currentPeriodStart,
    });

    // 6. Write feed.append Outbox entry for member joined on shard (A-5, A-6, PRD 7.6)
    const outbox = await writeOutbox(tx, {
      kind: 'feed.append',
      teamId: newTeam.id,
      sourceKey: `membership:${membership.id}:ACTIVE`,
      payload: {
        teamId: newTeam.id,
        membershipId: membership.id,
        userId,
        joinedAt: currentPeriodStart.toISOString(),
      },
    });

    return { team: newTeam, outboxEntry: outbox };
  });

  // 7. Dispatch outbox entry after transaction commits (A-5)
  await dispatchOutboxEntry(outboxEntry);

  // 8. Warm caches in Redis (L-32)
  try {
    await redis.set(
      `team:${team.id}`,
      JSON.stringify({ shardIndex: team.shardIndex }),
      'EX',
      300, // 300s
    );
    await redis.set(
      `perm:${userId}:${team.id}`,
      'OWNER',
      'EX',
      60, // 60s
    );
  } catch {
    // Non-fatal cache warm
  }

  // 9. Trigger RYOW for user on Shard 0 (PRD 7.5, AGENTS.md A-9)
  await markUserWrite(userId);

  return {
    id: team.id,
    name: team.name,
    timezone: team.timezone,
    shardIndex: team.shardIndex,
    weekStartsOn: team.weekStartsOn,
    role: 'OWNER',
    createdAt: team.createdAt.toISOString(),
  };
}
