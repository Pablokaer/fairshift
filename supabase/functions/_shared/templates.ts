// Notification copy for push and e-mail, in English and Brazilian Portuguese.
// Times are always rendered in the organization's timezone.

export type Locale = 'en' | 'pt-BR';

type Payload = Record<string, unknown> & {
  queue_name?: string;
  org_name?: string;
  org_timezone?: string;
  starts_at?: string;
  ends_at?: string;
  unit?: string;
  expires_at?: string;
  position?: number;
  offer_id?: string;
  shift_id?: string;
  queue_id?: string;
  token?: string;
  role?: string;
  reason?: string;
};

export interface Rendered {
  title: string;
  body: string;
  url?: string; // in-app route for deep links
  subject?: string;
}

function fmtRange(p: Payload, locale: Locale): string {
  if (!p.starts_at || !p.ends_at) return '';
  const tz = p.org_timezone || 'UTC';
  const start = new Date(p.starts_at);
  const end = new Date(p.ends_at);
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const t = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t.format(start)}–${t.format(end)}`;
}

function fmtTime(iso: string | undefined, p: Payload, locale: Locale): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: p.org_timezone || 'UTC', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

const T = {
  en: {
    offer_received: (p: Payload, l: Locale) => ({
      title: `Shift offered: ${p.queue_name}`,
      body: `${fmtRange(p, l)}${p.unit ? ` · ${p.unit}` : ''}. Accept by ${fmtTime(p.expires_at, p, l)}.`,
      url: `/offer/${p.offer_id}`,
    }),
    offer_expiring: (p: Payload, l: Locale) => ({
      title: 'Your offer is about to expire',
      body: `${p.queue_name}: ${fmtRange(p, l)}. Respond before ${fmtTime(p.expires_at, p, l)}.`,
      url: `/offer/${p.offer_id}`,
    }),
    offer_expired: (p: Payload, l: Locale) => ({
      title: 'Offer expired',
      body: `The ${p.queue_name} shift (${fmtRange(p, l)}) was offered to the next person. You kept your place.`,
      url: '/',
    }),
    offer_revoked: (p: Payload, l: Locale) => ({
      title: 'Offer withdrawn',
      body: `The ${p.queue_name} shift (${fmtRange(p, l)}) is no longer available to you.`,
      url: '/',
    }),
    shift_assigned: (p: Payload, l: Locale) => ({
      title: 'Shift confirmed',
      body: `You are working ${fmtRange(p, l)}${p.unit ? ` · ${p.unit}` : ''} (${p.queue_name}).`,
      url: '/shifts',
    }),
    shift_cancelled: (p: Payload, l: Locale) => ({
      title: 'Shift cancelled',
      body: `${p.queue_name}: ${fmtRange(p, l)} was cancelled. You are back at your original place in the queue${p.position ? ` (#${p.position})` : ''}.`,
      url: '/',
    }),
    shift_updated: (p: Payload, l: Locale) => ({
      title: 'Shift details updated',
      body: `${p.queue_name}: ${fmtRange(p, l)}. Open the app for the new notes.`,
      url: '/shifts',
    }),
    eligible_to_rejoin: (p: Payload) => ({
      title: 'Your shift is done. Rejoin the queue?',
      body: `Tap to rejoin ${p.queue_name}. You will join at the end.`,
      url: `/queue/${p.queue_id}`,
    }),
    auto_rejoined: (p: Payload) => ({
      title: 'Back in the queue',
      body: `Your shift is done and you rejoined ${p.queue_name} automatically (#${p.position}).`,
      url: `/queue/${p.queue_id}`,
    }),
    moved_top3: (p: Payload) => ({
      title: `You're #${p.position} in ${p.queue_name}`,
      body: 'You are in the top 3. The next shift may be yours.',
      url: `/queue/${p.queue_id}`,
    }),
    auto_paused: (p: Payload) => ({
      title: 'You were paused',
      body: `Several offers in ${p.queue_name} expired without an answer. You kept your place; resume when you are available.`,
      url: `/queue/${p.queue_id}`,
    }),
    removed_from_queue: (p: Payload) => ({
      title: 'Removed from a queue',
      body: `An admin removed you from ${p.queue_name}. Reason: ${p.reason ?? ''}`,
      url: '/',
    }),
    pool_added: (p: Payload) => ({ title: 'New queue available', body: `You can now join ${p.queue_name}.`, url: `/queue/${p.queue_id}` }),
    pool_removed: (p: Payload) => ({ title: 'Queue access removed', body: `You are no longer eligible for ${p.queue_name}.`, url: '/' }),
    rejoin_allowed: (p: Payload) => ({ title: 'You can rejoin', body: `An admin allowed you to rejoin ${p.queue_name}.`, url: `/queue/${p.queue_id}` }),
    no_show_recorded: (p: Payload, l: Locale) => ({
      title: 'No-show recorded',
      body: `${p.queue_name}: ${fmtRange(p, l)} was marked as a no-show.`,
      url: '/shifts',
    }),
    shift_unfilled: (p: Payload, l: Locale) => ({
      title: 'Shift unfilled',
      body: `Nobody in ${p.queue_name} accepted ${fmtRange(p, l)}.`,
      url: '/admin/shifts',
    }),
    withdrawal: (p: Payload, l: Locale) => ({
      title: 'A shift was given back',
      body: `${p.queue_name}: ${fmtRange(p, l)} is being re-offered.`,
      url: '/admin/shifts',
    }),
    invite: (p: Payload) => ({
      title: `You're invited to ${p.org_name}`,
      subject: `Invitation to join ${p.org_name} on FairShift`,
      body: `You have been invited to join ${p.org_name} on FairShift, the fair queue for extra shifts.`,
    }),
  },
  'pt-BR': {
    offer_received: (p: Payload, l: Locale) => ({
      title: `Plantão oferecido: ${p.queue_name}`,
      body: `${fmtRange(p, l)}${p.unit ? ` · ${p.unit}` : ''}. Aceite até ${fmtTime(p.expires_at, p, l)}.`,
      url: `/offer/${p.offer_id}`,
    }),
    offer_expiring: (p: Payload, l: Locale) => ({
      title: 'Sua oferta está prestes a expirar',
      body: `${p.queue_name}: ${fmtRange(p, l)}. Responda antes de ${fmtTime(p.expires_at, p, l)}.`,
      url: `/offer/${p.offer_id}`,
    }),
    offer_expired: (p: Payload, l: Locale) => ({
      title: 'Oferta expirada',
      body: `O plantão de ${p.queue_name} (${fmtRange(p, l)}) foi oferecido à próxima pessoa. Você manteve sua posição.`,
      url: '/',
    }),
    offer_revoked: (p: Payload, l: Locale) => ({
      title: 'Oferta retirada',
      body: `O plantão de ${p.queue_name} (${fmtRange(p, l)}) não está mais disponível para você.`,
      url: '/',
    }),
    shift_assigned: (p: Payload, l: Locale) => ({
      title: 'Plantão confirmado',
      body: `Você trabalha ${fmtRange(p, l)}${p.unit ? ` · ${p.unit}` : ''} (${p.queue_name}).`,
      url: '/shifts',
    }),
    shift_cancelled: (p: Payload, l: Locale) => ({
      title: 'Plantão cancelado',
      body: `${p.queue_name}: ${fmtRange(p, l)} foi cancelado. Você voltou à sua posição original na fila${p.position ? ` (nº ${p.position})` : ''}.`,
      url: '/',
    }),
    shift_updated: (p: Payload, l: Locale) => ({
      title: 'Detalhes do plantão atualizados',
      body: `${p.queue_name}: ${fmtRange(p, l)}. Abra o app para ver as novas observações.`,
      url: '/shifts',
    }),
    eligible_to_rejoin: (p: Payload) => ({
      title: 'Seu plantão terminou. Voltar para a fila?',
      body: `Toque para entrar de novo em ${p.queue_name}. Você entrará no final.`,
      url: `/queue/${p.queue_id}`,
    }),
    auto_rejoined: (p: Payload) => ({
      title: 'De volta à fila',
      body: `Seu plantão terminou e você voltou automaticamente para ${p.queue_name} (nº ${p.position}).`,
      url: `/queue/${p.queue_id}`,
    }),
    moved_top3: (p: Payload) => ({
      title: `Você é o nº ${p.position} em ${p.queue_name}`,
      body: 'Você está entre os 3 primeiros. O próximo plantão pode ser seu.',
      url: `/queue/${p.queue_id}`,
    }),
    auto_paused: (p: Payload) => ({
      title: 'Você foi pausado',
      body: `Várias ofertas em ${p.queue_name} expiraram sem resposta. Você manteve sua posição; retome quando estiver disponível.`,
      url: `/queue/${p.queue_id}`,
    }),
    removed_from_queue: (p: Payload) => ({
      title: 'Removido de uma fila',
      body: `Um administrador removeu você de ${p.queue_name}. Motivo: ${p.reason ?? ''}`,
      url: '/',
    }),
    pool_added: (p: Payload) => ({ title: 'Nova fila disponível', body: `Agora você pode entrar em ${p.queue_name}.`, url: `/queue/${p.queue_id}` }),
    pool_removed: (p: Payload) => ({ title: 'Acesso à fila removido', body: `Você não é mais elegível para ${p.queue_name}.`, url: '/' }),
    rejoin_allowed: (p: Payload) => ({ title: 'Você pode voltar', body: `Um administrador permitiu que você volte para ${p.queue_name}.`, url: `/queue/${p.queue_id}` }),
    no_show_recorded: (p: Payload, l: Locale) => ({
      title: 'Falta registrada',
      body: `${p.queue_name}: ${fmtRange(p, l)} foi marcado como falta.`,
      url: '/shifts',
    }),
    shift_unfilled: (p: Payload, l: Locale) => ({
      title: 'Plantão não preenchido',
      body: `Ninguém em ${p.queue_name} aceitou ${fmtRange(p, l)}.`,
      url: '/admin/shifts',
    }),
    withdrawal: (p: Payload, l: Locale) => ({
      title: 'Um plantão foi devolvido',
      body: `${p.queue_name}: ${fmtRange(p, l)} está sendo oferecido novamente.`,
      url: '/admin/shifts',
    }),
    invite: (p: Payload) => ({
      title: `Convite para ${p.org_name}`,
      subject: `Convite para entrar em ${p.org_name} no FairShift`,
      body: `Você foi convidado para entrar em ${p.org_name} no FairShift, a fila justa para plantões extras.`,
    }),
  },
} as const;

export function render(template: string, payload: Payload, locale: Locale): Rendered {
  const table = (T[locale] ?? T.en) as Record<string, (p: Payload, l: Locale) => Rendered>;
  const fn = table[template] ?? (T.en as Record<string, (p: Payload, l: Locale) => Rendered>)[template];
  if (!fn) return { title: 'FairShift', body: '' };
  return fn(payload, locale);
}

export function emailHtml(r: Rendered, link: string | undefined, locale: Locale): string {
  const cta = locale === 'pt-BR' ? 'Abrir o FairShift' : 'Open FairShift';
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#10213a;background:#f5f7fa;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(r.title)}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 20px">${esc(r.body)}</p>
${link ? `<a href="${esc(link)}" style="display:inline-block;background:#0b5c73;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${cta}</a>` : ''}
</div></body></html>`;
}
