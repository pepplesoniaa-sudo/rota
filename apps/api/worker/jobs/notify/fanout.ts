import { z } from 'zod';
import { runInSystemScope } from '../../../lib/data/scope';
import { processNotificationFanout } from '../../../lib/domain/notify/fanout';

export const notifyFanoutJobSchema = z
  .object({
    sourceKey: z.string().min(1),
    teamId: z.string().uuid(),
    type: z.string().min(1),
    actorUserId: z.string().uuid().optional(),
  })
  .strict();

export type NotifyFanoutJobData = z.infer<typeof notifyFanoutJobSchema>;

/**
 * Worker handler for notify.fanout (PRD 6.2).
 * Runs in system tenant scope (B-20).
 */
export async function handleNotifyFanout(data: unknown): Promise<{ created: number }> {
  const parsed = notifyFanoutJobSchema.parse(data);
  const jobId = `fanout:${parsed.sourceKey}`;

  return runInSystemScope(jobId, async () => {
    const created = await processNotificationFanout({
      sourceKey: parsed.sourceKey,
      teamId: parsed.teamId,
      type: parsed.type,
      actorUserId: parsed.actorUserId,
    });
    return { created };
  });
}
