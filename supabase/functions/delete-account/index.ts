// GDPR/LGPD account deletion.
// 1. As the user: public.delete_my_account() closes tickets, gives back future
//    shifts (the slot goes to the next person in line) and anonymizes the profile.
// 2. As service role: delete the auth user (e-mail, password, sessions).
// Audit-log rows are never modified; they keep pointing at the now-anonymous id.
import { adminDeleteUser, getUser, rpc } from '../_shared/rest.ts';

const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'auth.required' }, 401);
  const user = await getUser(jwt, ANON_KEY);
  if (!user) return json({ error: 'auth.required' }, 401);

  try {
    await rpc('delete_my_account', {}, jwt, ANON_KEY);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  try {
    await adminDeleteUser(user.id, SERVICE_ROLE_KEY);
  } catch (e) {
    return json({ error: 'account.delete_failed', detail: (e as Error).message }, 500);
  }
  return json({ ok: true });
});
