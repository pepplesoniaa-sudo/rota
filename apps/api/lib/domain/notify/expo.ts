import { logger } from '../../log';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export interface ExpoPushSuccessTicket {
  status: 'ok';
  id: string;
}

export interface ExpoPushErrorTicket {
  status: 'error';
  message: string;
  details?: {
    error?: 'DeviceNotRegistered' | string;
  };
}

export type ExpoPushTicket = ExpoPushSuccessTicket | ExpoPushErrorTicket;

/**
 * Sends a single push notification through Expo Push Service.
 * Locked tool L-17 / FR-27.
 */
export async function sendExpoPushNotification(message: ExpoPushMessage): Promise<ExpoPushTicket> {
  const expoPushUrl = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

  try {
    const res = await fetch(expoPushUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      logger.error({ status: res.status, errorText }, 'Expo push API HTTP error');
      return {
        status: 'error',
        message: `HTTP error ${res.status}: ${errorText}`,
      };
    }

    const json = (await res.json()) as { data?: ExpoPushTicket | ExpoPushTicket[] };
    const ticket = Array.isArray(json.data) ? json.data[0] : json.data;

    if (!ticket) {
      return {
        status: 'error',
        message: 'No ticket returned from Expo push service',
      };
    }

    return ticket;
  } catch (err: unknown) {
    logger.error({ err }, 'Network error communicating with Expo push service');
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown network error',
    };
  }
}
