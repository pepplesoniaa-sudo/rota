import { AppError, ERROR_CODES, formatUsd } from '@rota/shared';
import { dbShard0 } from '../../db';
import { calculateMonthlyPriceCents, PLAN_CONFIGS } from '../../billing/pricing';
import { Plan, SubscriptionStatus } from '@prisma/client';

export interface BillingOverview {
  plan: Plan;
  planName: string;
  activeSeats: number;
  paidSeats: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextRenewalAmountCents: number;
  status: SubscriptionStatus;
  scheduledPlan?: Plan | null;
  scheduledPlanDate?: string | null;
  isTrial: boolean;
  trialEndsAt?: string | null;
  firstChargeDueAt?: string | null;
  betterTierSavings?: {
    suggestedPlan: Plan;
    savingsMonthlyCents: number;
    message: string;
  } | null;
  hasSavedCard: boolean;
  unpaidChargesCount: number;
}

/**
 * Loads team billing overview for owner (FR-34, B-16).
 * Must be owner of the team.
 */
export async function getBillingOverview(teamId: string): Promise<BillingOverview> {
  const subscription = await dbShard0.subscription.findUnique({
    where: { teamId },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          memberships: {
            where: { status: 'ACTIVE' },
            select: { id: true },
          },
          paymentMethods: {
            where: { disabledAt: null },
            select: { id: true },
          },
        },
      },
      charges: {
        where: { status: { in: ['PENDING', 'FAILED', 'DEFERRED'] } },
        select: { id: true, kind: true, dueAt: true, status: true },
        orderBy: { dueAt: 'asc' },
      },
    },
  });

  if (!subscription) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Subscription not found');
  }

  const activeSeats = subscription.team.memberships.length;
  const currentPlan = subscription.plan;
  const renewalPlan = subscription.scheduledPlan ?? currentPlan;
  const nextRenewalAmountCents = calculateMonthlyPriceCents(renewalPlan, activeSeats);

  // FR-34: "Given Business would cost less than Team for the current seats (39 seats or more)..."
  let betterTierSavings: BillingOverview['betterTierSavings'] = null;
  if (currentPlan === Plan.TEAM && activeSeats >= 39) {
    const teamCost = calculateMonthlyPriceCents(Plan.TEAM, activeSeats);
    const businessCost = calculateMonthlyPriceCents(Plan.BUSINESS, activeSeats);
    if (businessCost < teamCost) {
      const savings = teamCost - businessCost;
      betterTierSavings = {
        suggestedPlan: Plan.BUSINESS,
        savingsMonthlyCents: savings,
        message: `Business would cost ${formatUsd(savings)} less per month.`,
      };
    }
  }

  const now = new Date();
  const trialCharge = subscription.charges.find(
    (c) => c.kind === 'SUBSCRIPTION' && c.status === 'PENDING' && c.dueAt > now,
  );
  const isTrial = subscription.plan === Plan.STARTER && Boolean(trialCharge);

  return {
    plan: currentPlan,
    planName: PLAN_CONFIGS[currentPlan].name,
    activeSeats,
    paidSeats: subscription.paidSeats,
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    nextRenewalAmountCents,
    status: subscription.status,
    scheduledPlan: subscription.scheduledPlan,
    scheduledPlanDate: subscription.scheduledPlan
      ? subscription.currentPeriodEnd.toISOString()
      : null,
    isTrial,
    trialEndsAt: trialCharge ? trialCharge.dueAt.toISOString() : null,
    firstChargeDueAt: trialCharge ? trialCharge.dueAt.toISOString() : null,
    betterTierSavings,
    hasSavedCard: subscription.team.paymentMethods.length > 0,
    unpaidChargesCount: subscription.charges.length,
  };
}
