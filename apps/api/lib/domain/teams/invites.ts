import crypto from 'node:crypto';
import {
  AcceptInviteResponse,
  AppError,
  CreateInviteBody,
  InviteDetailsResponse,
  InviteListResponse,
  InviteResponse,
} from '@rota/shared';
import { v7 as uuidv7 } from 'uuid';
import { createLedgerEntry } from '../../billing/ledger';
import { calculateMonthlyPriceCents } from '../../billing/pricing';
import { calculateProrationCents } from '../../billing/proration';
import { env } from '../../config/env';
import { dbShard0 } from '../../db';
import { dispatchOutboxEntry, writeOutbox } from '../../outbox/writer';
import { invalidatePermissionCache } from '../../auth/permissions';

/**
 * Creates an invite for a team (FR-09, PRD 7.2, B-7, B-23).
 */
export async function createInvite(
  teamId: string,
  actorUserId: string,
  actorRole: 'OWNER' | 'MANAGER' | 'STAFF',
  body: CreateInviteBody,
): Promise<InviteResponse> {
  // Manager can invite STAFF only; Owner can invite STAFF or MANAGER (B-23, FR-09)
  if (actorRole === 'MANAGER' && body.role === 'MANAGER') {
    throw new AppError('FORBIDDEN', 403, 'Managers cannot invite other managers');
  }

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const now = new Date();

  // 1. Fetch team subscription and current active seats + pending invites
  const subscription = await client.subscription.findUnique({
    where: { teamId },
  });
  if (!subscription) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const activeSeats = await client.membership.count({
    where: { teamId, status: 'ACTIVE' },
  });

  const pendingInvites = await client.invite.count({
    where: {
      teamId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });

  const totalCommittedSeats = activeSeats + pendingInvites;

  // Starter cap: 5 active plus pending seats (B-7, FR-09)
  if (subscription.plan === 'STARTER' && totalCommittedSeats >= 5) {
    throw new AppError(
      'SEAT_LIMIT_REACHED',
      409,
      'Starter plan is limited to 5 seats. Upgrade your plan to invite more members.',
    );
  }

  // 2. Compute seatImpact (FR-09, PRD 8.4)
  const addsPaidSeat = totalCommittedSeats + 1 > subscription.paidSeats;
  let monthlyIncreaseCents = 0;
  let prorationCentsIfAcceptedNow = 0;

  if (addsPaidSeat) {
    const newPaidSeats = totalCommittedSeats + 1;
    monthlyIncreaseCents =
      calculateMonthlyPriceCents(subscription.plan, newPaidSeats) -
      calculateMonthlyPriceCents(subscription.plan, subscription.paidSeats);

    const periodSeconds = Math.trunc(
      Number(
        (BigInt(subscription.currentPeriodEnd.getTime()) -
          BigInt(subscription.currentPeriodStart.getTime())) /
          1000n,
      ),
    );
    const remainingSeconds = Math.max(
      0,
      Math.trunc(
        Number((BigInt(subscription.currentPeriodEnd.getTime()) - BigInt(now.getTime())) / 1000n),
      ),
    );
    prorationCentsIfAcceptedNow = calculateProrationCents({
      deltaCents: monthlyIncreaseCents,
      remainingSeconds,
      periodSeconds,
    });
  }

  // 3. Generate 32 bytes base64url token, sha256 hash stored, expires in 7 days (L-33)
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const normalizedEmail = body.email ? body.email.toLowerCase().trim() : null;

  const invite = await client.invite.create({
    data: {
      teamId,
      tokenHash,
      role: body.role,
      email: normalizedEmail,
      createdByUserId: actorUserId,
      expiresAt,
    },
  });

  const inviteUrl = `https://${env.DEMO_HOST}/i/${rawToken}`;

  // 4. If email is provided, send invite email via EmailMessage & Outbox (FR-09, PRD 6.2)
  if (normalizedEmail) {
    const team = await client.team.findUnique({
      where: { id: teamId },
      select: { name: true },
    });

    const emailMsg = await client.emailMessage.create({
      data: {
        template: 'team-invite',
        to: normalizedEmail,
        vars: {
          inviteUrl,
          teamName: team?.name ?? 'Team',
          role: body.role,
        },
        status: 'QUEUED',
      },
    });

    const outboxEntry = await writeOutbox(client, {
      kind: 'email.send',
      sourceKey: `email:${emailMsg.id}`,
      payload: {
        template: 'team-invite',
        to: normalizedEmail,
        vars: {
          inviteUrl,
          teamName: team?.name ?? 'Team',
          role: body.role,
        },
        emailMessageId: emailMsg.id,
      },
      teamId,
    });

    await dispatchOutboxEntry(outboxEntry);
  }

  return {
    id: invite.id,
    teamId: invite.teamId,
    role: invite.role as 'STAFF' | 'MANAGER',
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
    inviteUrl,
    seatImpact: {
      addsPaidSeat,
      monthlyIncreaseCents,
      prorationCentsIfAcceptedNow,
    },
  };
}

/**
 * Retrieves pending invites for a team (PRD 7.2).
 */
export async function getPendingInvites(teamId: string): Promise<InviteListResponse> {
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const now = new Date();
  const invites = await client.invite.findMany({
    where: {
      teamId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    invites: invites.map((inv) => ({
      id: inv.id,
      teamId: inv.teamId,
      role: inv.role as 'STAFF' | 'MANAGER',
      email: inv.email,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
    })),
  };
}

/**
 * Revokes an invite (PRD 7.2).
 */
export async function revokeInvite(teamId: string, inviteId: string): Promise<{ ok: true }> {
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const invite = await client.invite.findFirst({
    where: { id: inviteId, teamId },
  });

  if (!invite) {
    throw new AppError('NOT_FOUND', 404, 'Invite not found');
  }

  if (invite.acceptedAt !== null) {
    throw new AppError('INVITE_INVALID', 410, 'Invite has already been accepted');
  }

  if (invite.revokedAt === null) {
    await client.invite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  return { ok: true };
}

/**
 * Public inspection of an invite link (FR-10, PRD 7.2, SEC-7).
 * Reads invite without consuming or modifying state.
 */
export async function getInviteByToken(token: string): Promise<InviteDetailsResponse> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const invite = await client.invite.findUnique({
    where: { tokenHash },
    include: {
      team: { select: { id: true, name: true } },
    },
  });

  if (
    !invite ||
    invite.acceptedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt <= now
  ) {
    throw new AppError('INVITE_INVALID', 410, 'Invite link is invalid, expired, or already used');
  }

  return {
    teamId: invite.teamId,
    teamName: invite.team.name,
    role: invite.role as 'STAFF' | 'MANAGER',
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

/**
 * Accepts an invite (FR-10, PRD 7.2, PRD 8.4, MB-12, MB-13).
 */
export async function acceptInvite(
  token: string,
  actorUserId: string,
): Promise<AcceptInviteResponse> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const initialInvite = await client.invite.findUnique({
    where: { tokenHash },
  });

  if (
    !initialInvite ||
    initialInvite.acceptedAt !== null ||
    initialInvite.revokedAt !== null ||
    initialInvite.expiresAt <= now
  ) {
    throw new AppError('INVITE_INVALID', 410, 'Invite link is invalid, expired, or already used');
  }

  const teamId = initialInvite.teamId;

  // Already an active member check (FR-10)
  const activeMembership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: actorUserId,
      },
    },
  });

  if (activeMembership && activeMembership.status === 'ACTIVE') {
    throw new AppError('ALREADY_MEMBER', 409, 'You are already an active member of this team');
  }

  // Serialized transaction using Subscription.version lock (MB-13)
  const { role, outboxEntries } = await client.$transaction(async (tx) => {
    // 1. Lock subscription row
    const subscription = await tx.subscription.update({
      where: { teamId },
      data: { version: { increment: 1 } },
    });

    if (subscription.status === 'READ_ONLY') {
      throw new AppError('TEAM_READ_ONLY', 403, 'Team is in read-only mode');
    }

    // 2. Re-check invite status inside transaction
    const invite = await tx.invite.findUnique({
      where: { id: initialInvite.id },
    });

    if (
      !invite ||
      invite.acceptedAt !== null ||
      invite.revokedAt !== null ||
      invite.expiresAt <= now
    ) {
      throw new AppError('INVITE_INVALID', 410, 'Invite link is invalid, expired, or already used');
    }

    // 3. Count active seats on primary inside transaction (MB-12)
    const activeSeats = await tx.membership.count({
      where: { teamId, status: 'ACTIVE' },
    });

    // Starter cap: 5 active seats (B-7)
    if (subscription.plan === 'STARTER' && activeSeats >= 5) {
      throw new AppError(
        'SEAT_LIMIT_REACHED',
        409,
        'Starter plan is limited to 5 seats. Upgrade your plan to add more members.',
      );
    }

    // 4. Reactivate existing membership (L19, FR-10) or create new
    let membershipId: string;
    const existingMembership = await tx.membership.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: actorUserId,
        },
      },
    });

    if (existingMembership) {
      membershipId = existingMembership.id;
      await tx.membership.update({
        where: { id: existingMembership.id },
        data: {
          role: invite.role,
          status: 'ACTIVE',
          joinedAt: now,
          endedAt: null,
        },
      });
    } else {
      const newMembership = await tx.membership.create({
        data: {
          teamId,
          userId: actorUserId,
          role: invite.role,
          status: 'ACTIVE',
          joinedAt: now,
        },
      });
      membershipId = newMembership.id;
    }

    // 5. Mark invite accepted
    await tx.invite.update({
      where: { id: invite.id },
      data: {
        acceptedAt: now,
        acceptedByUserId: actorUserId,
      },
    });

    const entriesToDispatch: Parameters<typeof dispatchOutboxEntry>[0][] = [];

    // 6. Seat add and proration rule (FR-10, FR-38, PRD 8.4, B-5, B-7)
    const newActiveSeats = activeSeats + 1;
    if (newActiveSeats > subscription.paidSeats) {
      const monthlyIncreaseCents =
        calculateMonthlyPriceCents(subscription.plan, newActiveSeats) -
        calculateMonthlyPriceCents(subscription.plan, subscription.paidSeats);

      const periodSeconds = Math.trunc(
        Number(
          (BigInt(subscription.currentPeriodEnd.getTime()) -
            BigInt(subscription.currentPeriodStart.getTime())) /
            1000n,
        ),
      );
      const remainingSeconds = Math.max(
        0,
        Math.trunc(
          Number((BigInt(subscription.currentPeriodEnd.getTime()) - BigInt(now.getTime())) / 1000n),
        ),
      );

      const prorationCents = calculateProrationCents({
        deltaCents: monthlyIncreaseCents,
        remainingSeconds,
        periodSeconds,
      });

      const chargeId = uuidv7();
      const periodStartIso = subscription.currentPeriodStart.toISOString();
      const idempotencyKey = `seat-proration:${subscription.id}:${newActiveSeats}:${periodStartIso}`;

      // A proration under 100 cents is collected at renewal (PRD 8.2)
      const dueAt = prorationCents < 100 ? subscription.currentPeriodEnd : now;

      const charge = await tx.charge.create({
        data: {
          id: chargeId,
          teamId,
          subscriptionId: subscription.id,
          kind: 'SEAT_PRORATION',
          status: 'PENDING',
          amountCents: prorationCents,
          currency: 'USD',
          idempotencyKey,
          lineItems: [
            {
              label: 'Extra seat proration',
              amountCents: prorationCents,
            },
          ],
          dueAt,
        },
      });

      // Write CHARGE_SEAT_PRORATION ledger entry (MB-9)
      await createLedgerEntry(tx, {
        teamId,
        chargeId: charge.id,
        type: 'CHARGE_SEAT_PRORATION',
        amountCents: prorationCents,
        idempotencyKey: `charge:${charge.id}`,
        description: 'Seat proration charge',
      });

      // Update paidSeats to new active seats
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { paidSeats: newActiveSeats },
      });

      // Outbox notify.fanout for SEAT_ADDED (L56, L60)
      const notifyEntry = await writeOutbox(tx, {
        kind: 'notify.fanout',
        sourceKey: `seat-added:${subscription.id}:${newActiveSeats}`,
        payload: {
          sourceKey: `seat-added:${subscription.id}:${newActiveSeats}`,
          teamId,
          type: 'SEAT_ADDED',
        },
        teamId,
      });
      entriesToDispatch.push(notifyEntry);
    }

    // 7. Write feed.append outbox entry (FR-10, A-5)
    const joinedAtIso = now.toISOString();
    const feedEntry = await writeOutbox(tx, {
      kind: 'feed.append',
      sourceKey: `member-joined:${membershipId}:${joinedAtIso}`,
      payload: {
        teamId,
        membershipId,
        userId: actorUserId,
        joinedAt: joinedAtIso,
      },
      teamId,
    });
    entriesToDispatch.push(feedEntry);

    return {
      role: invite.role as 'STAFF' | 'MANAGER',
      outboxEntries: entriesToDispatch,
    };
  });

  // Post-commit tasks
  for (const entry of outboxEntries) {
    await dispatchOutboxEntry(entry);
  }

  await invalidatePermissionCache(actorUserId, teamId);

  return {
    ok: true,
    teamId,
    role,
  };
}
