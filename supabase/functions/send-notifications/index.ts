// Drains public.notification_outbox: Expo push first, then e-mail (fallback for
// offers when push could not be delivered, or always when the user opted in).
// Invoked by pg_cron / pg_net with `Authorization: Bearer $CRON_SECRET`.
import { rpc } from '../_shared/rest.ts';
import { emailHtml, render, type Locale } from '../_shared/templates.ts';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:8081').replace(/\/$/, '');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'FairShift <no-reply@example.com>';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

interface OutboxRow {
  id: number;
  channel: 'push' | 'email';
  template: string;
  payload: Record<string, unknown>;
  is_fallback: boolean;
  attempts: number;
  user_id: string | null;
  to_email: string | null;
  user_email: string | null;
  locale: Locale;
  push_tokens: string[];
  push_already_sent: boolean;
}

type Result = { status: 'sent' | 'skipped' | 'retry' | 'failed'; error?: string; invalidTokens?: string[] };

async function sendPush(row: OutboxRow): Promise<Result> {
  const tokens = row.push_tokens.filter((t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['));
  if (tokens.length === 0) return { status: 'skipped', error: 'no_device' };
  const r = render(row.template, row.payload, row.locale);
  const messages = tokens.map((to) => ({
    to,
    title: r.title,
    body: r.body,
    sound: 'default',
    priority: row.template.startsWith('offer_') ? 'high' : 'default',
    channelId: row.template.startsWith('offer_') ? 'offers' : 'default',
    data: { url: r.url, type: row.template },
  }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) return { status: 'retry', error: `expo_http_${res.status}` };
  const json = await res.json();
  const tickets: Array<{ status: string; details?: { error?: string } }> = json.data ?? [];
  const invalidTokens = tickets
    .map((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? tokens[i] : null))
    .filter((t): t is string => !!t);
  const anyOk = tickets.some((t) => t.status === 'ok');
  if (anyOk) return { status: 'sent', invalidTokens };
  return { status: invalidTokens.length === tokens.length ? 'skipped' : 'retry', error: 'expo_ticket_error', invalidTokens };
}

async function sendEmail(row: OutboxRow): Promise<Result> {
  if (row.is_fallback && row.push_already_sent) return { status: 'skipped', error: 'push_delivered' };
  const to = row.to_email ?? row.user_email;
  if (!to) return { status: 'skipped', error: 'no_email' };
  const r = render(row.template, row.payload, row.locale);
  const link =
    row.template === 'invite' ? `${APP_URL}/invite/${row.payload.token}` : r.url ? `${APP_URL}${r.url}` : APP_URL;
  const subject = r.subject ?? r.title;
  if (!RESEND_API_KEY) {
    // Local development: no provider configured. Log instead of sending.
    console.log(`[email:console] to=${to} subject="${subject}" link=${link}`);
    return { status: 'sent', error: 'console' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html: emailHtml(r, link, row.locale), text: `${r.body}\n\n${link}` }),
  });
  if (res.ok) return { status: 'sent' };
  return { status: res.status >= 500 || res.status === 429 ? 'retry' : 'failed', error: `resend_http_${res.status}` };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }
  let processed = 0;
  for (let batch = 0; batch < 10; batch++) {
    let rows: OutboxRow[];
    try {
      rows = (await rpc<OutboxRow[]>('claim_notification_outbox', { p_limit: 50 }, SERVICE_ROLE_KEY, SERVICE_ROLE_KEY)) ?? [];
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
    }
    if (rows.length === 0) break;
    // Push rows come first in each batch so e-mail fallbacks see their result.
    for (const row of rows) {
      let result: Result;
      try {
        result = row.channel === 'push' ? await sendPush(row) : await sendEmail(row);
      } catch (e) {
        result = { status: 'retry', error: String(e).slice(0, 300) };
      }
      await rpc('complete_notification_outbox', {
        p_id: row.id,
        p_status: result.status,
        p_error: result.error ?? null,
        p_invalid_tokens: result.invalidTokens ?? [],
      }, SERVICE_ROLE_KEY, SERVICE_ROLE_KEY);
      processed++;
    }
  }
  return new Response(JSON.stringify({ processed }), { headers: { 'Content-Type': 'application/json' } });
});
