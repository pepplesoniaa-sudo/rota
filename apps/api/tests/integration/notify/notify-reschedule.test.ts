import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleNotifyReschedule } from '../../../worker/jobs/notify/reschedule';

interface MockNotification {
  id: string;
  userId: string;
  status: string;
  scheduledFor: Date;
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
let mockUserSettings: MockUserSettings | null = null;
const mockJobRemove = vi.fn();
const mockQueueAdd = vi.fn();
const mockGetJob = vi.fn();

vi.mock('../../../worker/queues', () => ({
  getQueue: vi.fn(() => ({
    getJob: mockGetJob,
    add: mockQueueAdd,
  })),
  JOB_RETRY_POLICIES: {
    'notify.deliver': { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
    'notify.release': { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
  },
  JobId: {
    notifyDeliver: (id: string, scheduledIso: string) => `deliver:${id}:${scheduledIso}`,
    notifyRelease: (userId: string, releaseIso: string) => `release:${userId}:${releaseIso}`,
  },
}));

vi.mock('../../../lib/db', () => ({
  dbShard0: {
    userSettings: {
      findUnique: vi.fn(async () => mockUserSettings),
    },
    notification: {
      findMany: vi.fn(async ({ where }: { where: { userId: string; status: string } }) => {
        return mockNotifications.filter(
          (n) => n.userId === where.userId && n.status === where.status,
        );
      }),
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
  },
}));

describe('PRD 6.2 & FR-28, FR-31: notify.reschedule Job Handler', () => {
  const userId = '018f6e80-7711-7000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJob.mockResolvedValue({ remove: mockJobRemove });
    mockUserSettings = {
      userId,
      timezone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 1320, // 22:00
      quietEndMinute: 420, // 07:00
      quietAfterNightShift: false,
    };
    mockNotifications = [
      {
        id: 'notif-1',
        userId,
        status: 'SCHEDULED',
        scheduledFor: new Date('2026-11-03T23:00:00.000Z'),
      },
      {
        id: 'notif-2',
        userId,
        status: 'SCHEDULED',
        scheduledFor: new Date('2026-11-03T23:30:00.000Z'),
      },
    ];
  });

  it('reschedules pending notifications and updates queue when user changes quiet hours', async () => {
    const result = await handleNotifyReschedule({ userId, settingsVersion: 2 });

    expect(result.rescheduledCount).toBe(2);
    expect(mockGetJob).toHaveBeenCalledTimes(2);
    expect(mockJobRemove).toHaveBeenCalledTimes(2);
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when no pending notifications exist', async () => {
    mockNotifications = [];
    const result = await handleNotifyReschedule({ userId });
    expect(result.rescheduledCount).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
