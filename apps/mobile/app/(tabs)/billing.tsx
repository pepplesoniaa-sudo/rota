import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { api } from '../../src/lib/api/client';
import { queryKeys, STALE_TIMES } from '../../src/lib/query/client';
import { useAppStore } from '../../src/lib/state/app-store';
import { TeamSwitcher } from '../../src/ui/components/TeamSwitcher';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';

interface BillingOverview {
  plan: 'STARTER' | 'TEAM' | 'BUSINESS';
  planName: string;
  activeSeats: number;
  paidSeats: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextRenewalAmountCents: number;
  status: 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED';
  scheduledPlan?: string | null;
  scheduledPlanDate?: string | null;
  isTrial: boolean;
  betterTierSavings?: {
    suggestedPlan: string;
    savingsMonthlyCents: number;
    message: string;
  } | null;
  hasSavedCard: boolean;
  unpaidChargesCount: number;
}

interface PlanPreviewResponse {
  type: 'UPGRADE' | 'DOWNGRADE' | 'NO_OP';
  prorationCents: number;
  newMonthlyPriceCents: number;
  message: string;
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
  },
  content: {
    padding: theme.space[4] ?? 16,
    gap: theme.space[4] ?? 16,
  },
  card: {
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.space[4] ?? 16,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
    gap: theme.space[3] ?? 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planBadge: {
    backgroundColor: theme.color.primaryContainer,
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: 4,
    borderRadius: theme.radius.full,
  },
  planBadgeText: {
    color: theme.color.onPrimaryContainer,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '800',
  },
  statusBadge: {
    paddingHorizontal: theme.space[2] ?? 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
  },
  statusBadgeText: {
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '700',
  },
  title: {
    fontSize: theme.typography.titleLarge.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
  },
  priceText: {
    fontSize: 28,
    fontWeight: '800',
    color: theme.color.primary,
  },
  periodText: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSurfaceVariant,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.space[1] ?? 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.outlineVariant,
  },
  statLabel: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
  },
  statValue: {
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: theme.color.onSurface,
  },
  planSelectorTitle: {
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
    marginTop: theme.space[2] ?? 8,
  },
  planButtonRow: {
    flexDirection: 'row',
    gap: theme.space[2] ?? 8,
  },
  planBtn: {
    flex: 1,
    paddingVertical: theme.space[3] ?? 12,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    backgroundColor: theme.color.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
    minHeight: 48,
    justifyContent: 'center',
  },
  planBtnSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  planBtnText: {
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
  },
  planBtnTextSelected: {
    color: theme.color.onPrimary,
  },
  previewBox: {
    backgroundColor: theme.color.surface,
    padding: theme.space[4] ?? 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.primaryContainer,
    gap: theme.space[2] ?? 8,
  },
  previewTitle: {
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    color: theme.color.primary,
  },
  previewText: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurface,
  },
  confirmBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: theme.space[3] ?? 12,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: theme.space[2] ?? 8,
  },
  confirmBtnText: {
    color: theme.color.onPrimary,
    fontWeight: '700',
    fontSize: theme.typography.bodyMedium.fontSize,
  },
  bannerWarning: {
    backgroundColor: theme.color.warningContainer,
    padding: theme.space[3] ?? 12,
    borderRadius: theme.radius.md,
  },
  bannerWarningText: {
    color: theme.color.onWarningContainer,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space[6] ?? 24,
    gap: theme.space[2] ?? 8,
  },
}));

function formatCentsToUsd(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

/**
 * Requirement 5: Payments and Proration Screen.
 * B-15: Displays server-calculated cents; never calculates money on the client.
 * B-16: Accessible to team OWNER only.
 */
export default function BillingScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const qc = useQueryClient();

  const activeTeamId = useAppStore((state) => state.activeTeamId);
  const activeRole = useAppStore((state) => state.activeRole);

  const [selectedPlan, setSelectedPlan] = useState<'STARTER' | 'TEAM' | 'BUSINESS' | null>(null);
  const [previewData, setPreviewData] = useState<PlanPreviewResponse | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const isOwner = activeRole === 'OWNER';

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.billing(activeTeamId ?? ''),
    queryFn: async () => {
      if (!activeTeamId) return null;
      return api.get<BillingOverview>(`/teams/${activeTeamId}/billing`);
    },
    enabled: Boolean(activeTeamId && isOwner),
    staleTime: STALE_TIMES.billing, // L-32: 0s staleTime for billing
  });

  const handleSelectPlan = async (plan: 'STARTER' | 'TEAM' | 'BUSINESS') => {
    if (!activeTeamId || plan === data?.plan) {
      setSelectedPlan(null);
      setPreviewData(null);
      return;
    }

    setSelectedPlan(plan);
    setIsPreviewing(true);
    setPreviewData(null);

    try {
      // B-15: Send plan change through /billing/preview first
      const preview = await api.post<PlanPreviewResponse>(
        `/teams/${activeTeamId}/billing/preview`,
        { plan },
      );
      setPreviewData(preview);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      Alert.alert('Plan Preview Error', msg);
      setSelectedPlan(null);
    } finally {
      setIsPreviewing(false);
    }
  };

  const changePlanMutation = useMutation({
    mutationFn: async () => {
      if (!activeTeamId || !selectedPlan) return;
      await api.post(`/teams/${activeTeamId}/billing/plan`, {
        plan: selectedPlan,
      });
    },
    onSuccess: () => {
      Alert.alert('Plan Updated', `Successfully updated plan to ${selectedPlan}.`);
      setSelectedPlan(null);
      setPreviewData(null);
      void qc.invalidateQueries({ queryKey: queryKeys.billing(activeTeamId ?? '') });
    },
    onError: (err: Error) => {
      Alert.alert('Update Failed', err.message);
    },
  });

  if (!activeTeamId) {
    return (
      <View style={styles.container}>
        <TeamSwitcher />
        <View style={styles.centerContainer}>
          <Text style={styles.title}>Select a Team</Text>
          <Text style={styles.statLabel}>
            Please select a team above to view billing and subscription details.
          </Text>
        </View>
      </View>
    );
  }

  if (!isOwner) {
    return (
      <View style={styles.container}>
        <TeamSwitcher />
        <View style={styles.centerContainer}>
          <Text style={styles.title}>Owner Access Required</Text>
          <Text style={[styles.statLabel, { textAlign: 'center' }]}>
            Billing management, plan adjustments, and subscription proration are restricted to the
            Team Owner (Rule B-16).
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading || !data) {
    return (
      <View style={styles.container}>
        <TeamSwitcher />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.color.primary} />
          <Text style={styles.statLabel}>Loading billing overview...</Text>
        </View>
      </View>
    );
  }

  const renewalDate = DateTime.fromISO(data.currentPeriodEnd).toFormat('MMMM d, yyyy');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TeamSwitcher />

      {/* Subscription Status Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{data.planName.toUpperCase()}</Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  data.status === 'ACTIVE'
                    ? theme.color.successContainer
                    : theme.color.warningContainer,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                {
                  color:
                    data.status === 'ACTIVE'
                      ? theme.color.onSuccessContainer
                      : theme.color.onWarningContainer,
                },
              ]}
            >
              {data.status}
            </Text>
          </View>
        </View>

        <Text style={styles.priceText}>{formatCentsToUsd(data.nextRenewalAmountCents)}</Text>
        <Text style={styles.periodText}>Renewal due on {renewalDate}</Text>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Active Staff Seats</Text>
          <Text style={styles.statValue}>{data.activeSeats}</Text>
        </View>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Billed High-Water Seats</Text>
          <Text style={styles.statValue}>{data.paidSeats}</Text>
        </View>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Payment Method</Text>
          <Text style={styles.statValue}>
            {data.hasSavedCard ? 'Card on file (Tokenized)' : 'Test Checkout Mode'}
          </Text>
        </View>

        {data.betterTierSavings && (
          <View style={styles.bannerWarning}>
            <Text style={styles.bannerWarningText}>💡 {data.betterTierSavings.message}</Text>
          </View>
        )}
      </View>

      {/* Plan Switching & Proration Preview */}
      <View style={styles.card}>
        <Text style={styles.planSelectorTitle}>Switch Subscription Plan</Text>
        <Text style={styles.periodText}>
          Proration is automatically calculated to the exact second (Rule B-5).
        </Text>

        <View style={styles.planButtonRow}>
          {(['STARTER', 'TEAM', 'BUSINESS'] as const).map((plan) => {
            const isCurrent = data.plan === plan;
            const isSelected = selectedPlan === plan;
            return (
              <TouchableOpacity
                key={plan}
                style={[styles.planBtn, (isSelected || isCurrent) && styles.planBtnSelected]}
                onPress={() => void handleSelectPlan(plan)}
                disabled={isCurrent}
              >
                <Text
                  style={[
                    styles.planBtnText,
                    (isSelected || isCurrent) && styles.planBtnTextSelected,
                  ]}
                >
                  {plan}
                  {isCurrent ? '\n(Current)' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isPreviewing && <ActivityIndicator size="small" color={theme.color.primary} />}

        {previewData && (
          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>
              {previewData.type === 'UPGRADE' ? 'Upgrade Summary' : 'Downgrade Summary'}
            </Text>
            <Text style={styles.previewText}>{previewData.message}</Text>
            <Text style={styles.previewText}>
              Proration Charge Today:{' '}
              <Text style={{ fontWeight: '700' }}>
                {formatCentsToUsd(previewData.prorationCents)}
              </Text>
            </Text>
            <Text style={styles.previewText}>
              New Monthly Price:{' '}
              <Text style={{ fontWeight: '700' }}>
                {formatCentsToUsd(previewData.newMonthlyPriceCents)}
              </Text>
            </Text>

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={() => changePlanMutation.mutate()}
              disabled={changePlanMutation.isPending}
            >
              {changePlanMutation.isPending ? (
                <ActivityIndicator color={theme.color.onPrimary} />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm {selectedPlan} Change</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
