// Typed data access. All queue logic lives in the database; the client only
// calls RPCs and reads what RLS allows.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database } from './database.types';
import { supabase } from './supabase';

type Fns = Database['public']['Functions'];
type Tables = Database['public']['Tables'];
export type RpcName = keyof Fns;
export type RpcArgs<N extends RpcName> = Fns[N]['Args'];
export type RpcReturn<N extends RpcName> = Fns[N]['Returns'];

export type MyQueue = RpcReturn<'my_queues'>[number];
export type MyShift = RpcReturn<'my_shifts'>[number];
export type Offer = RpcReturn<'get_offer'>[number];
export type RosterRow = RpcReturn<'queue_roster'>[number];
export type AdminShift = RpcReturn<'admin_shifts'>[number];
export type AuditRow = RpcReturn<'admin_audit'>[number];
export type Member = RpcReturn<'admin_members'>[number];
export type FairnessRow = RpcReturn<'fairness_report'>[number];
export type QueueStat = RpcReturn<'queue_stats'>[number];
export type QueueRow = Tables['queues']['Row'];
export type InviteRow = Tables['invites']['Row'];
export type NotificationRow = Tables['notifications']['Row'];

export async function rpc<N extends RpcName>(name: N, args?: RpcArgs<N>): Promise<RpcReturn<N>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(name, args ?? {});
  if (error) throw error;
  return data as RpcReturn<N>;
}

/** Generic mutation for an RPC; refreshes every query on success (state is server-owned). */
export function useRpc<N extends RpcName>(name: N) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: RpcArgs<N>) => rpc(name, args),
    onSettled: () => qc.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export function useMyQueues(orgId: string | undefined) {
  return useQuery({
    queryKey: ['my_queues', orgId],
    enabled: !!orgId,
    queryFn: () => rpc('my_queues', { p_org: orgId }),
    refetchInterval: 60_000, // safety net if the realtime connection drops
  });
}

export function useMyShifts(scope: 'upcoming' | 'past', orgId: string | undefined) {
  return useQuery({
    queryKey: ['my_shifts', scope, orgId],
    enabled: !!orgId,
    queryFn: () => rpc('my_shifts', { p_scope: scope, p_org: orgId }),
  });
}

export function useOffer(offerId: string | undefined) {
  return useQuery({
    queryKey: ['offer', offerId],
    enabled: !!offerId,
    queryFn: async () => (await rpc('get_offer', { p_offer: offerId! }))[0] ?? null,
  });
}

export function useInbox(userId: string | null) {
  return useQuery({
    queryKey: ['inbox', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useNotificationPrefs(userId: string | null) {
  return useQuery({
    queryKey: ['notification_prefs', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_prefs').select('*');
      if (error) throw error;
      return data;
    },
  });
}

export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId!).single();
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export function useQueues(orgId: string | undefined) {
  return useQuery({
    queryKey: ['queues', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .eq('org_id', orgId!)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return data;
    },
  });
}

export function useQueue(queueId: string | undefined) {
  return useQuery({
    queryKey: ['queue', queueId],
    enabled: !!queueId,
    queryFn: async () => {
      const { data, error } = await supabase.from('queues').select('*').eq('id', queueId!).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useRoster(queueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['roster', queueId],
    enabled: !!queueId && enabled,
    queryFn: () => rpc('queue_roster', { p_queue: queueId! }),
    refetchInterval: 60_000,
  });
}

export function useAdminShifts(orgId: string | undefined, queueId?: string) {
  return useQuery({
    queryKey: ['admin_shifts', orgId, queueId],
    enabled: !!orgId,
    queryFn: () =>
      rpc('admin_shifts', {
        p_org: orgId!,
        p_queue: queueId,
        p_from: new Date(Date.now() - 14 * 86_400_000).toISOString(),
        p_to: new Date(Date.now() + 120 * 86_400_000).toISOString(),
      }),
    refetchInterval: 60_000,
  });
}

export function useShiftHistory(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['shift_history', shiftId],
    enabled: !!shiftId,
    queryFn: () => rpc('shift_offer_history', { p_shift: shiftId! }),
  });
}

export function useMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['members', orgId],
    enabled: !!orgId,
    queryFn: () => rpc('admin_members', { p_org: orgId! }),
  });
}

export function useInvites(orgId: string | undefined) {
  return useQuery({
    queryKey: ['invites', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invites')
        .select('id, kind, email, code, role, queue_ids, expires_at, max_uses, use_count, revoked_at, created_at')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

export interface AuditFilters {
  types?: string[] | null;
  queueId?: string | null;
  subjectId?: string | null;
  from?: string | null;
  to?: string | null;
}

export function useAudit(orgId: string | undefined, f: AuditFilters) {
  return useQuery({
    queryKey: ['audit', orgId, f],
    enabled: !!orgId,
    queryFn: () =>
      rpc('admin_audit', {
        p_org: orgId!,
        p_types: f.types ?? undefined,
        p_queue: f.queueId ?? undefined,
        p_subject: f.subjectId ?? undefined,
        p_from: f.from ?? undefined,
        p_to: f.to ?? undefined,
        p_limit: 200,
      }),
  });
}

export function useFairness(orgId: string | undefined, days: number, queueId?: string | null) {
  return useQuery({
    queryKey: ['fairness', orgId, days, queueId],
    enabled: !!orgId,
    queryFn: async () => {
      const from = new Date(Date.now() - days * 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const [people, queues] = await Promise.all([
        rpc('fairness_report', { p_org: orgId!, p_from: from, p_to: to, p_queue: queueId ?? undefined }),
        rpc('queue_stats', { p_org: orgId!, p_from: from, p_to: to }),
      ]);
      return { people, queues };
    },
  });
}
