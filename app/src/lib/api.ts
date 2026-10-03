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

export type Profession = Database['public']['Enums']['profession'];
export type MyQueue = RpcReturn<'my_queue'>[number];
export type MyShift = RpcReturn<'my_shifts'>[number];
export type RosterRow = RpcReturn<'queue_roster'>[number];
export type AdminShift = RpcReturn<'admin_shifts'>[number];
export type QueueOverview = RpcReturn<'admin_queue_overview'>[number];
export type AuditRow = RpcReturn<'admin_audit'>[number];
export type Professional = RpcReturn<'admin_professionals'>[number];
export type FairnessRow = RpcReturn<'fairness_report'>[number];
export type QueueStat = RpcReturn<'queue_stats'>[number];
export type NotificationRow = Tables['notifications']['Row'];

/** One person assigned to a shift (admin_shifts.assignees). */
export interface Assignee {
  assignment_id: string;
  user_id: string;
  display_name: string;
  status: Database['public']['Enums']['assignment_status'];
  position: number | null;
  assigned_at: string;
  reason: string | null;
}

export const assigneesOf = (s: AdminShift) => (s.assignees as unknown as Assignee[]) ?? [];

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
/** The caller's queue in this hospital: state, own position and the total. */
export function useMyQueue(orgId: string | undefined) {
  return useQuery({
    queryKey: ['my_queue', orgId],
    enabled: !!orgId,
    queryFn: async () => (await rpc('my_queue', { p_org: orgId }))[0] ?? null,
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
// Managers
// ---------------------------------------------------------------------------
export function useHospitalCode(orgId: string | undefined) {
  return useQuery({
    queryKey: ['hospital_code', orgId],
    enabled: !!orgId,
    queryFn: async () => (await rpc('admin_hospital_code', { p_org: orgId! }))[0] ?? null,
  });
}

export function useQueueOverview(orgId: string | undefined) {
  return useQuery({
    queryKey: ['queue_overview', orgId],
    enabled: !!orgId,
    queryFn: () => rpc('admin_queue_overview', { p_org: orgId! }),
    refetchInterval: 60_000,
  });
}

export function useRoster(queueId: string | undefined) {
  return useQuery({
    queryKey: ['roster', queueId],
    enabled: !!queueId,
    queryFn: () => rpc('queue_roster', { p_queue: queueId! }),
    refetchInterval: 60_000,
  });
}

export type ShiftScope = 'open' | 'drafts' | 'history';

export function useAdminShifts(
  orgId: string | undefined,
  scope: ShiftScope,
  filters: { profession?: Profession | null; days?: number | null } = {},
) {
  return useQuery({
    queryKey: ['admin_shifts', orgId, scope, filters],
    enabled: !!orgId,
    queryFn: () =>
      rpc('admin_shifts', {
        p_org: orgId!,
        p_scope: scope,
        p_profession: filters.profession ?? undefined,
        p_from: filters.days ? new Date(Date.now() - filters.days * 86_400_000).toISOString() : undefined,
        p_to: filters.days ? new Date(Date.now() + 60 * 86_400_000).toISOString() : undefined,
      }),
    refetchInterval: 60_000,
  });
}

export function useAdminShift(orgId: string | undefined, shiftId: string | undefined) {
  return useQuery({
    queryKey: ['admin_shift', orgId, shiftId],
    enabled: !!orgId && !!shiftId,
    queryFn: async () => (await rpc('admin_shifts', { p_org: orgId!, p_shift: shiftId! }))[0] ?? null,
  });
}

export function useProfessionals(orgId: string | undefined) {
  return useQuery({
    queryKey: ['professionals', orgId],
    enabled: !!orgId,
    queryFn: () => rpc('admin_professionals', { p_org: orgId! }),
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

export function useFairness(orgId: string | undefined, days: number, profession?: Profession | null) {
  return useQuery({
    queryKey: ['fairness', orgId, days, profession],
    enabled: !!orgId,
    queryFn: async () => {
      const from = new Date(Date.now() - days * 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const [people, queues] = await Promise.all([
        rpc('fairness_report', { p_org: orgId!, p_from: from, p_to: to, p_profession: profession ?? undefined }),
        rpc('queue_stats', { p_org: orgId!, p_from: from, p_to: to }),
      ]);
      return { people, queues };
    },
  });
}
