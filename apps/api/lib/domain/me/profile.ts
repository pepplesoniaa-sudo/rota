import { Prisma } from '@prisma/client';
import {
  AppError,
  MeResponse,
  MyTeamsResponse,
  PushTokenResponse,
  RegisterPushTokenBody,
  SettingsResponse,
  UpdateSettingsBody,
} from '@rota/shared';
import { dbShard0 } from '../../db';

export async function getMe(userId: string): Promise<MeResponse> {
  const user = await dbShard0.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'User not found');
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
  };
}

export async function getMySettings(userId: string): Promise<SettingsResponse> {
  const settings = await dbShard0.userSettings.findUnique({
    where: { userId },
  });

  if (!settings) {
    throw new AppError('NOT_FOUND', 404, 'User settings not found');
  }

  return {
    settings: {
      userId: settings.userId,
      timezone: settings.timezone,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietStartMinute: settings.quietStartMinute,
      quietEndMinute: settings.quietEndMinute,
      notifyShiftChanges: settings.notifyShiftChanges,
      notifySwaps: settings.notifySwaps,
      notifyMemberJoined: settings.notifyMemberJoined,
      notifyShiftReminders: settings.notifyShiftReminders,
      quietAfterNightShift: settings.quietAfterNightShift,
      use24HourClock: settings.use24HourClock,
      weekStartsOn: settings.weekStartsOn,
      version: settings.version,
      updatedAt: settings.updatedAt.toISOString(),
    },
  };
}

export async function updateMySettings(
  userId: string,
  body: UpdateSettingsBody,
): Promise<SettingsResponse> {
  const existing = await dbShard0.userSettings.findUnique({
    where: { userId },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'User settings not found');
  }

  if (existing.version !== body.version) {
    throw new AppError('VERSION_CONFLICT', 409, 'Settings version conflict; refresh and retry');
  }

  const updateData: Prisma.UserSettingsUpdateInput = {
    version: { increment: 1 },
  };

  if (body.timezone !== undefined) updateData.timezone = body.timezone;
  if (body.quietHoursEnabled !== undefined) updateData.quietHoursEnabled = body.quietHoursEnabled;
  if (body.quietStartMinute !== undefined) updateData.quietStartMinute = body.quietStartMinute;
  if (body.quietEndMinute !== undefined) updateData.quietEndMinute = body.quietEndMinute;
  if (body.notifyShiftChanges !== undefined)
    updateData.notifyShiftChanges = body.notifyShiftChanges;
  if (body.notifySwaps !== undefined) updateData.notifySwaps = body.notifySwaps;
  if (body.notifyMemberJoined !== undefined)
    updateData.notifyMemberJoined = body.notifyMemberJoined;
  if (body.notifyShiftReminders !== undefined)
    updateData.notifyShiftReminders = body.notifyShiftReminders;
  if (body.quietAfterNightShift !== undefined)
    updateData.quietAfterNightShift = body.quietAfterNightShift;
  if (body.use24HourClock !== undefined) updateData.use24HourClock = body.use24HourClock;
  if (body.weekStartsOn !== undefined) updateData.weekStartsOn = body.weekStartsOn;

  const updated = await dbShard0.userSettings.update({
    where: { userId },
    data: updateData,
  });

  return {
    settings: {
      userId: updated.userId,
      timezone: updated.timezone,
      quietHoursEnabled: updated.quietHoursEnabled,
      quietStartMinute: updated.quietStartMinute,
      quietEndMinute: updated.quietEndMinute,
      notifyShiftChanges: updated.notifyShiftChanges,
      notifySwaps: updated.notifySwaps,
      notifyMemberJoined: updated.notifyMemberJoined,
      notifyShiftReminders: updated.notifyShiftReminders,
      quietAfterNightShift: updated.quietAfterNightShift,
      use24HourClock: updated.use24HourClock,
      weekStartsOn: updated.weekStartsOn,
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
    },
  };
}

export async function registerPushToken(
  userId: string,
  body: RegisterPushTokenBody,
): Promise<PushTokenResponse> {
  const token = await dbShard0.$transaction(async (tx) => {
    // Reclaim expo push token if assigned elsewhere
    await tx.pushToken.deleteMany({
      where: {
        expoPushToken: body.expoPushToken,
        userId: { not: userId },
      },
    });

    return tx.pushToken.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId: body.deviceId,
        },
      },
      create: {
        userId,
        expoPushToken: body.expoPushToken,
        platform: body.platform,
        deviceId: body.deviceId,
      },
      update: {
        expoPushToken: body.expoPushToken,
        platform: body.platform,
        lastSeenAt: new Date(),
        disabledAt: null,
      },
    });
  });

  return {
    pushToken: {
      id: token.id,
      expoPushToken: token.expoPushToken,
      platform: token.platform,
      deviceId: token.deviceId,
      createdAt: token.createdAt.toISOString(),
    },
  };
}

export async function deletePushToken(
  userId: string,
  pushTokenId: string,
): Promise<{ ok: boolean }> {
  const existing = await dbShard0.pushToken.findUnique({
    where: { id: pushTokenId },
  });

  if (!existing || existing.userId !== userId) {
    throw new AppError('NOT_FOUND', 404, 'Push token not found');
  }

  await dbShard0.pushToken.delete({
    where: { id: pushTokenId },
  });

  return { ok: true };
}

export async function getMyTeams(userId: string): Promise<MyTeamsResponse> {
  const memberships = await dbShard0.membership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      team: {
        deletedAt: null,
      },
    },
    include: {
      team: true,
    },
    orderBy: {
      joinedAt: 'asc',
    },
  });

  return {
    teams: memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      timezone: m.team.timezone,
      role: m.role,
      weekStartsOn: m.team.weekStartsOn,
      joinedAt: m.joinedAt.toISOString(),
    })),
  };
}
