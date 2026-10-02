// Minimal, dependency-free Supabase REST helpers (no npm imports: faster cold
// starts and nothing to download at boot).
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

export async function rpc<T>(fn: string, args: Record<string, unknown>, bearer: string, apikey: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.message ?? `rpc ${fn} failed with ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return body as T;
}

export async function getUser(jwt: string, apikey: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${jwt}` } });
  if (!res.ok) return null;
  return await res.json();
}

export async function adminDeleteUser(userId: string, serviceKey: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`delete user failed with ${res.status}`);
}
