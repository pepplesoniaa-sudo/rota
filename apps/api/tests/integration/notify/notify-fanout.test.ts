import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType, Role, SwapType } from '@prisma/client';

interface MockUserSettings {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  notifyShiftChanges: boolean;
  notifySwaps: boolean;
  notifyMemberJoined: boolean;
  notifyShiftReminders: boolean;
  quietAfterNightShift: boolean;
}

interface MockTeam {
  id: string;
  name: string;
  timezone: string;
  shardIndex: number;
  ownerUserId: string;
}

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: Role;
  status: 'ACTIVE' | 'REMOVED' | 'LEFT';
}

interface MockShift {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startAt: Date;
  endAt: Date;
  status: string;
}

interface MockSwap {
  id: string;
  teamId: string;
  type: SwapType;
  status: string;
  requesterUserId: string;
  requesterShiftId: string;
  targetUserId: string;
  targetShiftId: string | null;
  expiresAt: Date;
}

interface MockActivityEvent {
  id: string;
  teamId: string;
  type: string;
  actorUserId: string | null;
  subjectShiftId?: string | null;
  payload: Record<string, unknown>;
}

interface MockNotification {
  id: string;
  userId: string;
  teamId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data: unknown;
  dedupeKey: string;
  status: string;
  scheduledFor: Date;
  sentAt?: Date | null;
}

let mockUserSettings: MockUserSettings[] = [];
let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockShifts: MockShift[] = [];
let mockSwaps: MockSwap[] = [];
let mockActivityEvents: MockActivityEvent[] = [];
let mockNotifications: MockNotification[] = [];
let mockOutboxProcessedKeys: string[] = [];
const mockQueueAdd = vi.fn();

vi.mock('../../../worker/queues', () => ({
  getQueue: vi.fn(() => ({
    add: mockQueueAdd,
  })),
  JOB_RETRY_POLICIES: {
    'notify.fanout': { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
    'notify.deliver': { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
    'notify.release': { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
  },
  JobId: {
    notifyFanout: (key: string) => `fanout:${key}`,
    notifyDeliver: (id: string, scheduledIso: string) => `deliver:${id}:${scheduledIso}`,
    notifyRelease: (userId: string, releaseIso: string) => `release:${userId}:${releaseIso}`,
  },
}));

vi.mock('../../../lib/db', () => ({
  dbShard0: {
    team: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return mockTeams.find((t) => t.id === where.id) ?? null;
      }),
    },
    membership: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { teamId?: string; userId?: string; status?: string; role?: { in: string[] } };
        }) => {
          return mockMemberships
            .filter((m) => {
              if (where.teamId && m.teamId !== where.teamId) return false;
              if (where.userId && m.userId !== where.userId) return false;
              if (where.status && m.status !== where.status) return false;
              if (where.role?.in && !where.role.in.includes(m.role)) return false;
              return true;
            })
            .map((m) => ({
              ...m,
              team: mockTeams.find((t) => t.id === m.teamId) ?? { id: m.teamId, shardIndex: 0 },
            }));
        },
      ),
    },
    userSettings: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) => {
        return mockUserSettings.filter((s) => where.userId.in.includes(s.userId));
      }),
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
        return mockUserSettings.find((s) => s.userId === where.userId) ?? null;
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Omit<MockNotification, 'id'> }) => {
        if (mockNotifications.some((n) => n.dedupeKey === data.dedupeKey)) {
          const err = new Error('Unique constraint failed on dedupeKey');
          (err as Error & { code: string }).code = 'P2002';
          throw err;
        }
        const created: MockNotification = { id: crypto.randomUUID(), ...data };
        mockNotifications.push(created);
        return created;
      }),
      findMany: vi.fn(async ({ where }: { where: { teamId?: string; dedupeKey?: string } }) => {
        return mockNotifications.filter((n) => {
          if (where.teamId && n.teamId !== where.teamId) return false;
          if (where.dedupeKey && n.dedupeKey !== where.dedupeKey) return false;
          return true;
        });
      }),
    },
    outbox: {
      updateMany: vi.fn(async ({ where }: { where: { sourceKey: string } }) => {
        mockOutboxProcessedKeys.push(where.sourceKey);
        return { count: 1 };
      }),
    },
  },
  getShardClient: vi.fn(() => ({
    shift: {
      findMany: vi.fn(async () => []),
    },
  })),
}));

vi.mock('../../../lib/data/router', () => ({
  getShardDbForTeam: vi.fn(async () => ({
    swapRequest: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return mockSwaps.find((s) => s.id === where.id) ?? null;
      }),
    },
    activityEvent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return mockActivityEvents.find((e) => e.id === where.id) ?? null;
      }),
    },
    shift: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return mockShifts.find((s) => s.id === where.id) ?? null;
      }),
    },
  })),
}));

import { processNotificationFanout } from '../../../lib/domain/notify/fanout';

describe('PRD 6.2 & FR-27 / FR-28 / FR-30 / B-41 / B-42: Notification Fanout', () => {
  const teamId = '018f6e80-7711-7000-8000-000000000001';
  const ownerId = '018f6e80-7711-7000-8000-000000000002';
  const staff1Id = '018f6e80-7711-7000-8000-000000000003';
  const staff2Id = '018f6e80-7711-7000-8000-000000000004';

  beforeEach(() => {
    mockUserSettings = [
      {
        userId: ownerId,
        timezone: 'America/New_York',
        quietHoursEnabled: true,
        quietStartMinute: 1320,
        quietEndMinute: 420,
        notifyShiftChanges: true,
        notifySwaps: true,
        notifyMemberJoined: true,
        notifyShiftReminders: false,
        quietAfterNightShift: false,
      },
      {
        userId: staff1Id,
        timezone: 'America/New_York',
        quietHoursEnabled: false,
        quietStartMinute: 1320,
        quietEndMinute: 420,
        notifyShiftChanges: true,
        notifySwaps: true,
        notifyMemberJoined: true,
        notifyShiftReminders: false,
        quietAfterNightShift: false,
      },
      {
        userId: staff2Id,
        timezone: 'America/New_York',
        quietHoursEnabled: true,
        quietStartMinute: 0,
        quietEndMinute: 1440,
        notifyShiftChanges: true,
        notifySwaps: true,
        notifyMemberJoined: true,
        notifyShiftReminders: false,
        quietAfterNightShift: false,
      },
    ];

    mockTeams = [
      {
        id: teamId,
        name: 'Clinic Team',
        timezone: 'America/New_York',
        shardIndex: 0,
        ownerUserId: ownerId,
      },
    ];

    mockMemberships = [
      { id: 'm1', teamId, userId: ownerId, role: Role.OWNER, status: 'ACTIVE' },
      { id: 'm2', teamId, userId: staff1Id, role: Role.STAFF, status: 'ACTIVE' },
      { id: 'm3', teamId, userId: staff2Id, role: Role.STAFF, status: 'ACTIVE' },
    ];

    mockShifts = [];
    mockSwaps = [];
    mockActivityEvents = [];
    mockNotifications = [];
    mockOutboxProcessedKeys = [];
    mockQueueAdd.mockClear();
  });

  it('B-41: never notifies the actor whose action triggered the event', async () => {
    const swapId = '018f6e80-7711-7000-8000-000000000010';
    mockSwaps.push({
      id: swapId,
      teamId,
      type: SwapType.TRADE,
      status: 'PENDING_PEER',
      requesterUserId: staff1Id,
      requesterShiftId: 'shift-1',
      targetUserId: staff2Id,
      targetShiftId: 'shift-2',
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    const count = await processNotificationFanout({
      sourceKey: `swap:${swapId}:REQUESTED`,
      teamId,
      type: 'SWAP_REQUESTED',
      actorUserId: staff1Id, // Actor
    });

    expect(count).toBe(1);

    // Recipient must be staff2Id only; actor staff1Id must get zero notifications (B-41)
    expect(mockNotifications).toHaveLength(1);
    expect(mockNotifications[0]?.userId).toBe(staff2Id);
    expect(mockNotifications[0]?.type).toBe(NotificationType.SWAP_REQUESTED);

    const actorNotifs = mockNotifications.filter((n) => n.userId === staff1Id);
    expect(actorNotifs).toHaveLength(0);
  });

  it('Exit criteria 4: swap lifecycle sends every transition push', async () => {
    const swapId = '018f6e80-7711-7000-8000-000000000020';
    mockSwaps.push({
      id: swapId,
      teamId,
      type: SwapType.TRADE,
      status: 'PENDING_MANAGER',
      requesterUserId: staff1Id,
      requesterShiftId: 'shift-1',
      targetUserId: staff2Id,
      targetShiftId: 'shift-2',
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    // 1. ACCEPTED transition -> notifies managers/owner
    await processNotificationFanout({
      sourceKey: `swap:${swapId}:ACCEPTED`,
      teamId,
      type: 'SWAP_ACCEPTED',
      actorUserId: staff2Id,
    });

    const acceptedNotif = mockNotifications.find((n) => n.type === NotificationType.SWAP_ACCEPTED);
    expect(acceptedNotif).toBeDefined();
    expect(acceptedNotif?.userId).toBe(ownerId);

    // 2. APPROVED transition -> notifies both requester and target coworker
    await processNotificationFanout({
      sourceKey: `swap:${swapId}:APPROVED`,
      teamId,
      type: 'SWAP_APPROVED',
      actorUserId: ownerId, // Approved by owner
    });

    const approvedNotifs = mockNotifications.filter(
      (n) => n.type === NotificationType.SWAP_APPROVED,
    );
    expect(approvedNotifs).toHaveLength(2);
    const approvedUserIds = approvedNotifs.map((n) => n.userId).sort();
    expect(approvedUserIds).toEqual([staff1Id, staff2Id].sort());

    // 3. EXPIRED transition -> notifies requester
    await processNotificationFanout({
      sourceKey: `swap:${swapId}:EXPIRED`,
      teamId,
      type: 'SWAP_EXPIRED',
    });

    const expiredNotif = mockNotifications.find((n) => n.type === NotificationType.SWAP_EXPIRED);
    expect(expiredNotif).toBeDefined();
    expect(expiredNotif?.userId).toBe(staff1Id);
  });

  it('B-42: schedule publish sends one notification per affected staff member and SHIFT_CREATED from publish notifies nobody', async () => {
    const publishEventId = '018f6e80-7711-7000-8000-000000000030';
    mockActivityEvents.push({
      id: publishEventId,
      teamId,
      type: 'SCHEDULE_PUBLISHED',
      actorUserId: ownerId,
      payload: {
        rangeSummary: '10 to 16 Nov',
        affectedUserCounts: {
          [staff1Id]: 3,
          [staff2Id]: 4,
        },
      },
    });

    await processNotificationFanout({
      sourceKey: `event:${publishEventId}`,
      teamId,
      type: 'SCHEDULE_PUBLISHED',
      actorUserId: ownerId,
    });

    const publishNotifs = mockNotifications.filter(
      (n) => n.type === NotificationType.SCHEDULE_PUBLISHED,
    );
    expect(publishNotifs).toHaveLength(2);

    const staff1Notif = publishNotifs.find((n) => n.userId === staff1Id);
    const staff2Notif = publishNotifs.find((n) => n.userId === staff2Id);

    expect(staff1Notif?.body).toBe('Your schedule for 10 to 16 Nov is out: 3 shifts.');
    expect(staff2Notif?.body).toBe('Your schedule for 10 to 16 Nov is out: 4 shifts.');

    // SHIFT_CREATED from publish notifies nobody
    const shiftCreatedEventId = '018f6e80-7711-7000-8000-000000000031';
    mockActivityEvents.push({
      id: shiftCreatedEventId,
      teamId,
      type: 'SHIFT_CREATED',
      actorUserId: ownerId,
      payload: { fromPublish: true },
    });

    const count = await processNotificationFanout({
      sourceKey: `event:${shiftCreatedEventId}`,
      teamId,
      type: 'SHIFT_CREATED',
    });

    expect(count).toBe(0);
  });

  it('idempotency: running fanout twice with identical sourceKey does not create duplicate rows (DB-11)', async () => {
    const shiftId = '018f6e80-7711-7000-8000-000000000040';
    mockShifts.push({
      id: shiftId,
      teamId,
      assigneeUserId: staff1Id,
      startAt: new Date('2026-11-10T09:00:00Z'),
      endAt: new Date('2026-11-10T17:00:00Z'),
      status: 'PUBLISHED',
    });

    const eventId = '018f6e80-7711-7000-8000-000000000041';
    mockActivityEvents.push({
      id: eventId,
      teamId,
      type: 'SHIFT_CHANGED',
      actorUserId: ownerId,
      subjectShiftId: shiftId,
      payload: {},
    });

    // Run 1st time
    await processNotificationFanout({
      sourceKey: `event:${eventId}`,
      teamId,
      type: 'SHIFT_CHANGED',
      actorUserId: ownerId,
    });

    // Run 2nd time (duplicate)
    await processNotificationFanout({
      sourceKey: `event:${eventId}`,
      teamId,
      type: 'SHIFT_CHANGED',
      actorUserId: ownerId,
    });

    const userNotifs = mockNotifications.filter(
      (n) => n.dedupeKey === `event:${eventId}:${staff1Id}`,
    );
    expect(userNotifs).toHaveLength(1);
    expect(mockOutboxProcessedKeys).toContain(`event:${eventId}`);
  });

  it('FR-28a: respects 8 hours quiet post-night shift when quietAfterNightShift is enabled', async () => {
    // In UTC, two hours ago: choose a timezone where twoHoursAgo was 06:00 AM
    // For any current UTC hour, find an offset so that hour = 6
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    const utcHour = twoHoursAgo.getUTCHours();
    const neededOffset = (6 - utcHour + 24) % 24;
    // Map offset to valid IANA timezone
    const offsetMap: Record<number, string> = {
      0: 'UTC',
      1: 'Europe/Paris',
      2: 'Europe/Athens',
      3: 'Asia/Riyadh',
      4: 'Asia/Dubai',
      5: 'Asia/Karachi',
      6: 'Asia/Dhaka',
      7: 'Asia/Bangkok',
      8: 'Asia/Singapore',
      9: 'Asia/Tokyo',
      10: 'Australia/Sydney',
      11: 'Pacific/Guadalcanal',
      12: 'Pacific/Auckland',
      13: 'Pacific/Tongatapu',
      14: 'Pacific/Kiritimati',
      15: 'America/Honolulu', // UTC-10
      16: 'America/Anchorage', // UTC-9
      17: 'America/Los_Angeles', // UTC-8
      18: 'America/Denver', // UTC-7
      19: 'America/Chicago', // UTC-6
      20: 'America/New_York', // UTC-5
      21: 'America/Halifax', // UTC-4
      22: 'America/Sao_Paulo', // UTC-3
      23: 'Atlantic/Cape_Verde', // UTC-1
    };
    const targetZone = offsetMap[neededOffset] ?? 'UTC';

    const s1 = mockUserSettings.find((s) => s.userId === staff1Id);
    if (s1) {
      s1.quietHoursEnabled = true;
      s1.quietAfterNightShift = true;
      s1.timezone = targetZone;
      // Ensure standard quiet hours are not covering the current minute
      s1.quietStartMinute = 1320; // 22:00
      s1.quietEndMinute = 420; // 07:00
    }

    // Mock getShardClient to return a night shift ending two hours ago
    const { getShardClient } = await import('../../../lib/db');
    vi.mocked(getShardClient).mockReturnValue({
      shift: {
        findMany: vi.fn(async () => [{ endsAt: twoHoursAgo }]),
      },
    } as unknown as ReturnType<typeof getShardClient>);

    const shiftId = '018f6e80-7711-7000-8000-000000000050';
    mockShifts.push({
      id: shiftId,
      teamId,
      assigneeUserId: staff1Id,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      endAt: new Date(Date.now() + 32 * 3600 * 1000),
      status: 'PUBLISHED',
    });

    const eventId = '018f6e80-7711-7000-8000-000000000051';
    mockActivityEvents.push({
      id: eventId,
      teamId,
      type: 'SHIFT_CHANGED',
      actorUserId: ownerId,
      subjectShiftId: shiftId,
      payload: {},
    });

    await processNotificationFanout({
      sourceKey: `event:${eventId}`,
      teamId,
      type: 'SHIFT_CHANGED',
      actorUserId: ownerId,
    });

    const notif = mockNotifications.find((n) => n.userId === staff1Id);
    expect(notif).toBeDefined();
    // In quiet hours due to FR-28a night shift: scheduled for 8 hours after twoHoursAgo
    const expectedRelease = new Date(twoHoursAgo.getTime() + 8 * 3600 * 1000);
    expect(notif?.scheduledFor.toISOString()).toBe(expectedRelease.toISOString());

    // Enqueued notify.release job
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'notify.release',
      expect.objectContaining({ userId: staff1Id, releaseAt: expectedRelease.toISOString() }),
      expect.anything(),
    );
  });
});
