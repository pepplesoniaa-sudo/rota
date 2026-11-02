import { Plan } from '@prisma/client';

export interface PlanConfig {
  plan: Plan;
  name: string;
  basePriceCents: number;
  includedSeats: number;
  extraSeatPriceCents: number;
  maxSeats: number | null;
}

/**
 * B-4 / PRD 8.1: Define plan prices in one server module only.
 * Starter: 2000 base, 5 seats included, no extra seats, cap 5.
 * Team: 5000 base, 15 included, 300 per extra seat.
 * Business: 12000 base, 40 included, 200 per extra seat.
 */
export const PLAN_CONFIGS: Record<Plan, PlanConfig> = {
  STARTER: {
    plan: 'STARTER',
    name: 'Starter',
    basePriceCents: 2000,
    includedSeats: 5,
    extraSeatPriceCents: 0,
    maxSeats: 5,
  },
  TEAM: {
    plan: 'TEAM',
    name: 'Team',
    basePriceCents: 5000,
    includedSeats: 15,
    extraSeatPriceCents: 300,
    maxSeats: null,
  },
  BUSINESS: {
    plan: 'BUSINESS',
    name: 'Business',
    basePriceCents: 12000,
    includedSeats: 40,
    extraSeatPriceCents: 200,
    maxSeats: null,
  },
};

/**
 * MB-2 / MB-3 / B-4: Pure calculation of monthly plan price.
 * monthlyPrice = base + max(0, seats - included) * extraSeatPrice
 */
export function calculateMonthlyPriceCents(plan: Plan, activeSeats: number): number {
  if (!Number.isSafeInteger(activeSeats) || activeSeats < 1) {
    throw new Error('Active seats must be a safe positive integer');
  }

  const config = PLAN_CONFIGS[plan];
  if (config.maxSeats !== null && activeSeats > config.maxSeats) {
    throw new Error(`Plan ${plan} cannot exceed ${config.maxSeats} seats`);
  }

  const extraSeats = Math.max(0, activeSeats - config.includedSeats);
  const total = config.basePriceCents + extraSeats * config.extraSeatPriceCents;

  if (!Number.isSafeInteger(total)) {
    throw new Error('Calculated monthly price is not a safe integer');
  }

  return total;
}

