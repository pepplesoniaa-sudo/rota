import { withApi } from '@/lib/api';
import { handleFlutterwaveWebhook } from '@/lib/domain/billing/webhook';
import { flutterwaveWebhookSchema } from '@rota/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'webhook',
    body: flutterwaveWebhookSchema,
  },
  async ({ req, body }) => {
    const signature = req.headers.get('verif-hash');
    return handleFlutterwaveWebhook(body as Record<string, unknown>, signature);
  },
);
