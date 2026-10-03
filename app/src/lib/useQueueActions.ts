import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/Confirm';
import { rpc, type MyQueue } from './api';
import { errorMessage } from './errors';

/**
 * Join / leave / pause / resume with confirmation dialogs that spell out the
 * consequences for the person's position.
 */
export function useQueueActions() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  }

  const join = async (q: MyQueue) => {
    const ok = await confirm({
      title: t('queue.join_title', { queue: t(`queue_in_sentence.${q.profession}`) }),
      message: t('queue.join_message', { position: (q.queue_total ?? 0) + 1 }),
      confirmLabel: t('queue.join'),
    });
    if (ok && q.queue_id) await run('join', () => rpc('join_queue', { p_queue: q.queue_id! }));
  };

  const leave = async (q: MyQueue) => {
    const ok = await confirm({
      title: t('queue.leave_title'),
      message: t('queue.leave_message', { position: q.queue_position }),
      confirmLabel: t('queue.leave'),
      destructive: true,
    });
    if (ok && q.queue_id) await run('leave', () => rpc('leave_queue', { p_queue: q.queue_id! }));
  };

  const pause = async (q: MyQueue) => {
    const ok = await confirm({
      title: t('queue.pause_title'),
      message: t('queue.pause_message'),
      confirmLabel: t('queue.pause'),
    });
    if (ok && q.queue_id) await run('pause', () => rpc('pause_queue', { p_queue: q.queue_id! }));
  };

  const resume = (q: MyQueue) => (q.queue_id ? run('resume', () => rpc('resume_queue', { p_queue: q.queue_id! })) : undefined);

  const setAutoRejoin = (q: MyQueue, enabled: boolean) =>
    q.queue_id ? run('auto', () => rpc('set_queue_auto_rejoin', { p_queue: q.queue_id!, p_enabled: enabled })) : undefined;

  return { join, leave, pause, resume, setAutoRejoin, busy, error, clearError: () => setError(null) };
}
