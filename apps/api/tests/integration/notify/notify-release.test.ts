import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleNotifyRelease } from '../../../worker/jobs/notify/release';
import { NotificationType } from '@prisma/client';

interface MockPushToken {
  id: string;
  userId: string;
  expoPushToken: string;
  disabledAt: Date | null;
}

interface MockNotification {
  id: string;
  userId: string;
  team_id?: string | null;
  teamId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: unknown;
  status: string;
  scheduled_for?: Date;
  scheduledFor: Date;
  sentAt?: Date | null;
  expoTicketId?: string | null;
  digestId?: string | null;
  dedupeKey?: string;
}

let mockNotifications: MockNotification[] = [];
let mockPushTokens: MockPushToken[] = [];
const mockSendExpo = vi.fn();

vi.mock('../../../lib/domain/notify/expo', () => ({
  sendExpoPushNotification: (...args: unknown[]) => mockSendExpo(...args),
}));

vi.mock('../../../lib/data/router', () => ({
  lockDueNotifications: vi.fn(async (_tx: unknown, userId: string, now: Date) => {
    return mockNotifications
      .filter((n) => n.userId === userId && n.status === 'SCHEDULED' && n.scheduledFor <= now)
      .map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        teamId: n.teamId ?? null,
      }));
  }),
}));

vi.mock('../../../lib/db', () => ({
  dbShard0: {
    $transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        pushToken: {
          findMany: vi.fn(async ({ where }: { where: { userId: string; disabledAt: null } }) => {
            return mockPushTokens.filter((t) => t.userId === where.userId && t.disabledAt === null);
          }),
        },
        notification: {
          create: vi.fn(async ({ data }: { data: Omit<MockNotification, 'id'> }) => {
            const created: MockNotification = {
              id: crypto.randomUUID(),
              ...data,
            };
            mockNotifications.push(created);
            return created;
          }),
          updateMany: vi.fn(
            async ({
              where,
              data,
            }: {
              where: { id: { in: string[] } };
              data: Partial<MockNotification>;
            }) => {
              let count = 0;
              for (const n of mockNotifications) {
                if (where.id.in.includes(n.id)) {
                  Object.assign(n, data);
                  count++;
                }
              }
              return { count };
            },
          ),
          update: vi.fn(
            async ({ where, data }: { where: { id: string }; data: Partial<MockNotification> }) => {
              const notif = mockNotifications.find((n) => n.id === where.id);
              if (notif) {
                Object.assign(notif, data);
                return notif;
              }
              throw new Error('Not found');
            },
          ),
        },
      };
      return cb(tx);
    }),
  },
}));

describe('PRD 6.2 & FR-30 / Exit Criteria 2: notify.release Job Handler', () => {
  const userId = '018f6e80-7711-7000-8000-000000000001';
  const teamId = '018f6e80-7711-7000-8000-000000000002';
  const releaseAt = '2026-11-03T07:00:00.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPushTokens = [
      {
        id: 'token-1',
        userId,
        expoPushToken: 'ExponentPushToken[user-device-1]',
        disabledAt: null,
      },
    ];
    mockNotifications = [];
    mockSendExpo.mockResolvedValue({ status: 'ok', id: 'ticket-release-1' });
  });

  it('Exit criteria 2: release job tested with 7 held notifications coalesces into ONE digest and sends 1 push', async () => {
    const pastDate = new Date(Date.now() - 10000);
    // Create 7 held notifications
    for (let i = 1; i <= 7; i++) {
      mockNotifications.push({
        id: `held-notif-${i}`,
        userId,
        teamId,
        type: NotificationType.SHIFT_CHANGED,
        title: `Shift Updated ${i}`,
        body: `Shift ${i} has been modified`,
        status: 'SCHEDULED',
        scheduledFor: pastDate,
      });
    }

    const result = await handleNotifyRelease({ userId, releaseAt });

    expect(result.released).toBe(7);
    expect(result.digest).toBe(true);
    expect(result.digestId).toBeDefined();

    // Verify 1 summary push sent to device
    expect(mockSendExpo).toHaveBeenCalledTimes(1);
    expect(mockSendExpo).toHaveBeenCalledWith({
      to: 'ExponentPushToken[user-device-1]',
      title: 'Schedule Updates',
      body: 'You have 7 updates from your teams.',
      data: { url: 'rota://notifications', invalidate: ['feed', 'myShifts'] },
      sound: 'default',
    });

    // Verify the DIGEST row exists in DB
    const digestRow = mockNotifications.find((n) => n.id === result.digestId);
    expect(digestRow).toBeDefined();
    expect(digestRow?.type).toBe(NotificationType.DIGEST);
    expect(digestRow?.status).toBe('SENT');
    expect(digestRow?.expoTicketId).toBe('ticket-release-1');

    // Verify all 7 held notifications are marked SENT with digestId
    for (let i = 1; i <= 7; i++) {
      const notif = mockNotifications.find((n) => n.id === `held-notif-${i}`);
      expect(notif?.status).toBe('SENT');
      expect(notif?.digestId).toBe(result.digestId);
    }
  });

  it('delivers notifications individually when fewer than 4 held notifications are due', async () => {
    const pastDate = new Date(Date.now() - 10000);
    for (let i = 1; i <= 3; i++) {
      mockNotifications.push({
        id: `held-notif-${i}`,
        userId,
        teamId,
        type: NotificationType.SWAP_REQUESTED,
        title: `Swap Request ${i}`,
        body: `Peer requested swap ${i}`,
        status: 'SCHEDULED',
        scheduledFor: pastDate,
      });
    }

    const result = await handleNotifyRelease({ userId, releaseAt });

    expect(result.released).toBe(3);
    expect(result.digest).toBe(false);
    expect(result.digestId).toBeUndefined();

    // 3 individual pushes sent
    expect(mockSendExpo).toHaveBeenCalledTimes(3);

    // No DIGEST row created
    const digestRows = mockNotifications.filter((n) => n.type === NotificationType.DIGEST);
    expect(digestRows).toHaveLength(0);

    // All 3 marked SENT with no digestId
    for (let i = 1; i <= 3; i++) {
      const notif = mockNotifications.find((n) => n.id === `held-notif-${i}`);
      expect(notif?.status).toBe('SENT');
      expect(notif?.digestId).toBeUndefined();
    }
  });

  it('returns 0 released when no notifications are due', async () => {
    const result = await handleNotifyRelease({ userId, releaseAt });
    expect(result.released).toBe(0);
    expect(result.digest).toBe(false);
    expect(mockSendExpo).not.toHaveBeenCalled();
  });
});
