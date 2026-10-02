import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Subscribes to FairShift's private broadcast topics. Messages carry no data
 * (privacy): any message simply means "something changed, refetch".
 *   queue:<id>       a queue I'm eligible for
 *   org:<id>:admin   admin dashboards
 *   user:<id>        my inbox / offers
 */
export function useRealtimeTopics(topics: string[]) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = [...new Set(topics)].sort().join('|');

  useEffect(() => {
    if (!key) return;
    const invalidate = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => qc.invalidateQueries(), 200);
    };
    let cancelled = false;
    const channels: ReturnType<typeof supabase.channel>[] = [];
    (async () => {
      const { data } = await supabase.auth.getSession();
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      for (const topic of key.split('|')) {
        const ch = supabase
          .channel(topic, { config: { private: true } })
          .on('broadcast', { event: '*' }, invalidate)
          .subscribe((status) => {
            // After a reconnect, refetch in case we missed messages.
            if (status === 'SUBSCRIBED') invalidate();
          });
        channels.push(ch);
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [key, qc]);
}
