import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUserId } from './auth';
import { authStorage } from './storage';
import { supabase } from './supabase';

export type Role = 'owner' | 'admin' | 'staff';

export interface OrgMembership {
  org_id: string;
  role: Role;
  org: { id: string; name: string; timezone: string; staff_can_see_names: boolean };
}

interface OrgState {
  loading: boolean;
  orgs: OrgMembership[];
  current: OrgMembership | null;
  setCurrent: (orgId: string) => void;
  isAdmin: boolean;
  isOwner: boolean;
  refresh: () => Promise<unknown>;
}

const OrgContext = createContext<OrgState | null>(null);
const STORAGE_KEY = 'fairshift.currentOrg';

export function OrgProvider({ children }: { children: ReactNode }) {
  const userId = useUserId();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(() => authStorage.getItem(STORAGE_KEY));

  const query = useQuery({
    queryKey: ['memberships', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('org_id, role, organizations(id, name, timezone, staff_can_see_names)')
        .eq('user_id', userId!)
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? [])
        .filter((m) => m.organizations)
        .map((m) => ({ org_id: m.org_id, role: m.role as Role, org: m.organizations! }))
        .sort((a, b) => a.org.name.localeCompare(b.org.name));
    },
  });

  const orgs = query.data ?? [];
  const current = orgs.find((o) => o.org_id === selected) ?? orgs[0] ?? null;

  useEffect(() => {
    if (current && current.org_id !== selected) setSelected(current.org_id);
  }, [current, selected]);

  const setCurrent = useCallback(
    (orgId: string) => {
      authStorage.setItem(STORAGE_KEY, orgId);
      setSelected(orgId);
      qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<OrgState>(
    () => ({
      loading: query.isLoading,
      orgs,
      current,
      setCurrent,
      isAdmin: current?.role === 'owner' || current?.role === 'admin',
      isOwner: current?.role === 'owner',
      refresh: () => query.refetch(),
    }),
    [query.isLoading, orgs, current, setCurrent, query],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgState {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside OrgProvider');
  return ctx;
}
