import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '@prisma/client';
import { handleNotifyShiftReminder } from '../../../worker/jobs/notify/shift-reminder';

interface MockShift {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'DRAFT' | 'PUBLISHED';
  deletedAt: Date | null;
  position: string;
}

interface MockUserSettings {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  notifyShiftReminders: boolean;
  quietAfterNightShift: boolean;
}

interface MockNotification {
  id: string;
  userId: string;
  teamId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
  status: string;
  scheduledFor: Date;
}

let mockShifts: MockShift[] = [];
let mockUserSettings: MockUserSettings[] = [];
let mockNotifications: MockNotification[] = [];
const mockEnqueuedJobs: Array<{ queue: string; name: string; data: unknown; opts?: unknown }> = [];

vi.mock('../../../worker/queues', () => ({
  getQueue: vi.fn((queueName: string) => ({
    add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
      mockEnqueuedJobs.push({ queue: queueName, name, data, opts });
      return { id: 'mock-job-id' };
    }),
  })),
  JOB_RETRY_POLICIES: {
    'notify.deliver': { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
  },
  JobId: {
    notifyShiftReminder: (shiftId: string, startsAtIso: string) =>
      `reminder:${shiftId}:${startsAtIso}`,
    notifyDeliver: (notifId: string, scheduledIso: string) => `deliver:${notifId}:${scheduledIso}`,
  },
}));

vi.mock('../../../lib/db', () => {
  const shardClient = {
    shift: {
      findMany: vi.fn(async ({ where }: { where: { startsAt?: { gte?: Date; lte?: Date } } }) => {
        return mockShifts.filter((s) => {
          if (s.status !== 'PUBLISHED' || s.deletedAt !== null) return false;
          if (where.startsAt?.gte && s.startsAt < where.startsAt.gte) return false;
          if (where.startsAt?.lte && s.startsAt > where.startsAt.lte) return false;
          return true;
        });
      }),
    },
  };

  const globalClient = {
    userSettings: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
        return mockUserSettings.find((u) => u.userId === where.userId) ?? null;
      }),
    },
    team: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return { id: where.id, name: 'Metro Health Clinic' };
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
    },
  };

  return {
    dbShard0: globalClient,
    getShardClient: vi.fn(() => shardClient),
  };
});

describe('notify.shift-reminder (FR-45, PRD 6.2, Assumption 28)', () => {
  const teamId = '018f6e80-7711-7000-8000-000000000001';
  const staff1Id = '018f6e80-7711-7000-8000-000000000002';
  const staff2Id = '018f6e80-7711-7000-8000-000000000003';
  const staffQuietId = '018f6e80-7711-7000-8000-000000000004';

  beforeEach(() => {
    mockShifts = [];
    mockUserSettings = [
      {
        userId: staff1Id,
        timezone: 'UTC',
        quietHoursEnabled: false,
        quietStartMinute: 1320,
        quietEndMinute: 420,
        notifyShiftReminders: true,
        quietAfterNightShift: false,
      },
      {
        userId: staff2Id,
        timezone: 'UTC',
        quietHoursEnabled: false,
        quietStartMinute: 1320,
        quietEndMinute: 420,
        notifyShiftReminders: false, // Disabled
        quietAfterNightShift: false,
      },
      {
        userId: staffQuietId,
        timezone: 'UTC',
        quietHoursEnabled: true,
        quietStartMinute: 0,
        quietEndMinute: 1440, // 24-hour quiet window
        notifyShiftReminders: true,
        quietAfterNightShift: false,
      },
    ];
    mockNotifications = [];
    mockEnqueuedJobs.length = 0;
  });

  it('sends reminder 60m before shift for staff with notifyShiftReminders enabled outside quiet hours', async () => {
    const startsAt = new Date(Date.now() + 58 * 60 * 1000);
    mockShifts.push({
      id: '018f6e80-7711-7000-8000-000000000010',
      teamId,
      assigneeUserId: staff1Id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3600 * 1000),
      status: 'PUBLISHED',
      deletedAt: null,
      position: 'RN ICU',
    });

    const result = await handleNotifyShiftReminder();
    expect(result.sentCount).toBeGreaterThanOrEqual(1);

    const notif = mockNotifications.find((n) => n.userId === staff1Id);
    expect(notif).toBeDefined();
    expect(notif?.type).toBe(NotificationType.SHIFT_REMINDER);
    expect(notif?.title).toBe('Upcoming Shift Reminder');
    expect(notif?.body).toContain('Metro Health Clinic');
    expect(notif?.body).toContain('RN ICU');

    const deliverJob = mockEnqueuedJobs.find((j) => j.name === 'notify.deliver');
    expect(deliverJob).toBeDefined();
    expect((deliverJob?.data as { notificationId: string }).notificationId).toBe(notif?.id);
  });

  it('skips staff who have notifyShiftReminders disabled (FR-45)', async () => {
    const startsAt = new Date(Date.now() + 58 * 60 * 1000);
    mockShifts.push({
      id: '018f6e80-7711-7000-8000-000000000020',
      teamId,
      assigneeUserId: staff2Id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3600 * 1000),
      status: 'PUBLISHED',
      deletedAt: null,
      position: 'Staff Nurse',
    });

    const result = await handleNotifyShiftReminder();
    const notif = mockNotifications.find((n) => n.userId === staff2Id);
    expect(notif).toBeUndefined();
    expect(result.sentCount).toBe(0);
  });

  it('drops reminder when staff is in quiet hours (FR-45, Assumption 28)', async () => {
    const startsAt = new Date(Date.now() + 58 * 60 * 1000);
    mockShifts.push({
      id: '018f6e80-7711-7000-8000-000000000030',
      teamId,
      assigneeUserId: staffQuietId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3600 * 1000),
      status: 'PUBLISHED',
      deletedAt: null,
      position: 'Staff Nurse',
    });

    const result = await handleNotifyShiftReminder();
    const notif = mockNotifications.find((n) => n.userId === staffQuietId);
    expect(notif).toBeUndefined();
    expect(result.sentCount).toBe(0);
  });

  it('drops reminder if shift has already started (PRD 6.2)', async () => {
    // Shift started 5 minutes ago
    const startsAt = new Date(Date.now() - 5 * 60 * 1000);
    mockShifts.push({
      id: '018f6e80-7711-7000-8000-000000000040',
      teamId,
      assigneeUserId: staff1Id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3600 * 1000),
      status: 'PUBLISHED',
      deletedAt: null,
      position: 'Staff Nurse',
    });

    const result = await handleNotifyShiftReminder({
      windowStart: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      windowEnd: new Date(Date.now()).toISOString(),
    });

    expect(result.sentCount).toBe(0);
    const notif = mockNotifications.find((n) => n.userId === staff1Id);
    expect(notif).toBeUndefined();
  });

  it('idempotency: running shift reminder twice does not produce duplicate notifications (PRD 6.2)', async () => {
    const startsAt = new Date(Date.now() + 58 * 60 * 1000);
    mockShifts.push({
      id: '018f6e80-7711-7000-8000-000000000050',
      teamId,
      assigneeUserId: staff1Id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3600 * 1000),
      status: 'PUBLISHED',
      deletedAt: null,
      position: 'RN ICU',
    });

    await handleNotifyShiftReminder();
    await handleNotifyShiftReminder();

    const notifs = mockNotifications.filter((n) => n.userId === staff1Id);
    expect(notifs).toHaveLength(1);
  });
});
