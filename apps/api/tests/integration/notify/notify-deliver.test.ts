import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError, UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { handleNotifyDeliver } from '../../../worker/jobs/notify/deliver';

interface MockPushToken {
  id: string;
  userId: string;
  expoPushToken: string;
  disabledAt: Date | null;
}

interface MockNotification {
  id: string;
  userId: string;
  teamId?: string | null;
  type: string;
  title: string;
  body: string;
  data: unknown;
  status: string;
  scheduledFor: Date;
  sentAt?: Date | null;
  expoTicketId?: string | null;
  failureCode?: string | null;
  quietWindowAtSend?: unknown;
}

interface MockUserSettings {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  quietAfterNightShift: boolean;
}

let mockNotifications: MockNotification[] = [];
let mockPushTokens: MockPushToken[] = [];
let mockUserSettings: MockUserSettings | null = null;
const mockSendExpo = vi.fn();

vi.mock('../../../lib/domain/notify/expo', () => ({
  sendExpoPushNotification: (...args: unknown[]) => mockSendExpo(...args),
}));

vi.mock('../../../lib/db', () => ({
  dbShard0: {
    notification: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return mockNotifications.find((n) => n.id === where.id) ?? null;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<MockNotification> }) => {
          const index = mockNotifications.findIndex((n) => n.id === where.id);
          if (index === -1) throw new Error('Notification not found');
          mockNotifications[index] = { ...mockNotifications[index], ...data } as MockNotification;
          return mockNotifications[index];
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { userId: string; status: string; sentAt?: { gte: Date } };
        }) => {
          return mockNotifications.filter((n) => {
            if (n.userId !== where.userId) return false;
            if (n.status !== where.status) return false;
            if (where.sentAt?.gte && n.sentAt && n.sentAt < where.sentAt.gte) return false;
            return true;
          });
        },
      ),
    },
    userSettings: {
      findUnique: vi.fn(async () => mockUserSettings),
    },
    pushToken: {
      findMany: vi.fn(async ({ where }: { where: { userId: string; disabledAt: null } }) => {
        return mockPushTokens.filter((t) => t.userId === where.userId && t.disabledAt === null);
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<MockPushToken> }) => {
          const index = mockPushTokens.findIndex((t) => t.id === where.id);
          if (index !== -1) {
            mockPushTokens[index] = { ...mockPushTokens[index], ...data } as MockPushToken;
          }
          return mockPushTokens[index];
        },
      ),
    },
  },
}));

describe('PRD 6.2 & FR-27, FR-28, FR-30, B-43: notify.deliver Job Handler', () => {
  const userId = '018f6e80-7711-7000-8000-000000000001';
  const notifId = '018f6e80-7711-7000-8000-000000000002';
  const tokenId = '018f6e80-7711-7000-8000-000000000003';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserSettings = {
      userId,
      timezone: 'UTC',
      quietHoursEnabled: false,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      quietAfterNightShift: false,
    };
    mockPushTokens = [
      {
        id: tokenId,
        userId,
        expoPushToken: 'ExponentPushToken[mock-token-1]',
        disabledAt: null,
      },
    ];
    mockNotifications = [
      {
        id: notifId,
        userId,
        type: 'SHIFT_CHANGED',
        title: 'Shift Updated',
        body: 'Your shift has changed.',
        data: { url: 'rota://shifts' },
        status: 'SCHEDULED',
        scheduledFor: new Date(),
      },
    ];
    mockSendExpo.mockResolvedValue({ status: 'ok', id: 'ticket-123' });
  });

  it('delivers push to active token and marks notification SENT', async () => {
    const result = await handleNotifyDeliver({ notificationId: notifId });

    expect(result.sent).toBe(true);
    expect(result.pushed).toBe(true);
    expect(mockSendExpo).toHaveBeenCalledWith({
      to: 'ExponentPushToken[mock-token-1]',
      title: 'Shift Updated',
      body: 'Your shift has changed.',
      data: { url: 'rota://shifts' },
      sound: 'default',
    });

    const notif = mockNotifications.find((n) => n.id === notifId);
    expect(notif?.status).toBe('SENT');
    expect(notif?.expoTicketId).toBe('ticket-123');
  });

  it('handles DeviceNotRegistered: disables token and throws UnrecoverableError (PRD 6.2)', async () => {
    mockSendExpo.mockResolvedValue({
      status: 'error',
      message: 'The recipient device is not registered',
      details: { error: 'DeviceNotRegistered' },
    });

    await expect(handleNotifyDeliver({ notificationId: notifId })).rejects.toThrow(
      UnrecoverableError,
    );

    const token = mockPushTokens.find((t) => t.id === tokenId);
    expect(token?.disabledAt).not.toBeNull();

    const notif = mockNotifications.find((n) => n.id === notifId);
    expect(notif?.status).toBe('FAILED');
    expect(notif?.failureCode).toBe('DeviceNotRegistered');
  });

  it('Exit criteria 3 & B-43: send-time quiet hours check moves job to delayed and throws DelayedError without adding a new job', async () => {
    // Enable quiet hours such that current time is inside quiet hours
    // Set 0 to 1440 (all day quiet hours in UTC)
    if (mockUserSettings) {
      mockUserSettings.quietHoursEnabled = true;
      mockUserSettings.quietStartMinute = 0;
      mockUserSettings.quietEndMinute = 1440;
    }

    const mockJob = {
      id: `deliver:${notifId}`,
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await expect(
      handleNotifyDeliver({ notificationId: notifId }, mockJob, 'lock-token-123'),
    ).rejects.toThrow(DelayedError);

    expect(mockJob.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(mockSendExpo).not.toHaveBeenCalled();

    const notif = mockNotifications.find((n) => n.id === notifId);
    expect(notif?.status).toBe('SCHEDULED');
  });

  it('FR-30: hourly rate cap delays delivery when 10 pushes were sent in the last 60 minutes', async () => {
    const now = Date.now();
    // Populate 10 recently sent pushes
    for (let i = 0; i < 10; i++) {
      mockNotifications.push({
        id: `recent-notif-${i}`,
        userId,
        type: 'SHIFT_CHANGED',
        title: 'Recent',
        body: 'Recent notif',
        data: {},
        status: 'SENT',
        scheduledFor: new Date(now - (50 - i) * 60 * 1000),
        sentAt: new Date(now - (50 - i) * 60 * 1000),
      });
    }

    const mockJob = {
      id: `deliver:${notifId}`,
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await expect(
      handleNotifyDeliver({ notificationId: notifId }, mockJob, 'token-456'),
    ).rejects.toThrow(DelayedError);

    expect(mockJob.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(mockSendExpo).not.toHaveBeenCalled();
  });
});
