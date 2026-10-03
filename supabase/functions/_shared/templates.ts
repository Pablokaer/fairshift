// Notification copy for push and e-mail, in English and Brazilian Portuguese.
// Times are always rendered in the hospital's timezone.

export type Locale = 'en' | 'pt-BR';

type Payload = Record<string, unknown> & {
  profession?: 'doctor' | 'nurse';
  previous?: 'doctor' | 'nurse' | null;
  org_timezone?: string;
  starts_at?: string;
  ends_at?: string;
  unit?: string;
  notes?: string;
  slots?: number;
  filled?: number;
  position?: number;
  shift_id?: string;
  queue_id?: string;
  reason?: string;
  restored?: boolean;
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

const queueName = (p: Payload, l: Locale) =>
  l === 'pt-BR'
    ? p.profession === 'nurse' ? 'fila de enfermagem' : 'fila de médicos'
    : p.profession === 'nurse' ? "nurses' queue" : "doctors' queue";
const professionName = (x: Payload['profession'] | null | undefined, l: Locale) =>
  l === 'pt-BR' ? (x === 'nurse' ? 'Enfermagem' : 'Medicina') : x === 'nurse' ? 'Nurse' : 'Doctor';
const unit = (p: Payload) => (p.unit ? ` · ${p.unit}` : '');

const T = {
  en: {
    shift_assigned: (p: Payload, l: Locale) => ({
      title: 'You have a shift',
      body: `${fmtRange(p, l)}${unit(p)}. You were next in the ${queueName(p, l)}.${p.notes ? ` Notes: ${p.notes}` : ''}`,
      url: '/shifts',
    }),
    shift_cancelled: (p: Payload, l: Locale) => ({
      title: 'Shift cancelled',
      body: `${fmtRange(p, l)}${unit(p)} was cancelled. You are back at your original place in the queue${p.position ? ` (#${p.position})` : ''}.`,
      url: '/',
    }),
    shift_updated: (p: Payload, l: Locale) => ({
      title: 'Shift details updated',
      body: `${fmtRange(p, l)}${unit(p)}. Open the app for the new notes.`,
      url: '/shifts',
    }),
    eligible_to_rejoin: (p: Payload, l: Locale) => ({
      title: 'Your shift is done. Rejoin the queue?',
      body: `Tap to rejoin the ${queueName(p, l)}. You will join at the end.`,
      url: '/',
    }),
    auto_rejoined: (p: Payload, l: Locale) => ({
      title: 'Back in the queue',
      body: `Your shift is done and you rejoined the ${queueName(p, l)} automatically (#${p.position}).`,
      url: '/',
    }),
    moved_top3: (p: Payload, l: Locale) => ({
      title: `You're #${p.position} in the ${queueName(p, l)}`,
      body: 'You are in the top 3. The next shift may be yours.',
      url: '/',
    }),
    removed_from_queue: (p: Payload, l: Locale) => ({
      title: 'Removed from the queue',
      body: `A manager removed you from the ${queueName(p, l)}. Reason: ${p.reason ?? ''}`,
      url: '/',
    }),
    profession_changed: (p: Payload, l: Locale) => ({
      title: 'Your profession was updated',
      body: `A manager set your profession to ${professionName(p.profession, l)}. Join your new queue from the home screen.`,
      url: '/',
    }),
    shift_short: (p: Payload, l: Locale) => ({
      title: 'Shift not fully staffed',
      body: `${fmtRange(p, l)}${unit(p)}: ${p.filled ?? 0} of ${p.slots} slots filled. The rest fill automatically as people join the ${queueName(p, l)}.`,
      url: `/admin/shifts/${p.shift_id}`,
    }),
    shift_started_short: (p: Payload, l: Locale) => ({
      title: 'Shift started short-staffed',
      body: `${fmtRange(p, l)}${unit(p)} started with ${p.filled ?? 0} of ${p.slots} slots filled.`,
      url: `/admin/shifts/${p.shift_id}`,
    }),
    shift_given_back: (p: Payload, l: Locale) => ({
      title: 'A shift was given back',
      body: `${fmtRange(p, l)}${unit(p)}: the slot went to the next person in the ${queueName(p, l)}.`,
      url: `/admin/shifts/${p.shift_id}`,
    }),
  },
  'pt-BR': {
    shift_assigned: (p: Payload, l: Locale) => ({
      title: 'Você tem um plantão',
      body: `${fmtRange(p, l)}${unit(p)}. Você era o próximo da ${queueName(p, l)}.${p.notes ? ` Observações: ${p.notes}` : ''}`,
      url: '/shifts',
    }),
    shift_cancelled: (p: Payload, l: Locale) => ({
      title: 'Plantão cancelado',
      body: `${fmtRange(p, l)}${unit(p)} foi cancelado. Você voltou à sua posição original na fila${p.position ? ` (nº ${p.position})` : ''}.`,
      url: '/',
    }),
    shift_updated: (p: Payload, l: Locale) => ({
      title: 'Detalhes do plantão atualizados',
      body: `${fmtRange(p, l)}${unit(p)}. Abra o app para ver as novas observações.`,
      url: '/shifts',
    }),
    eligible_to_rejoin: (p: Payload, l: Locale) => ({
      title: 'Seu plantão terminou. Voltar para a fila?',
      body: `Toque para entrar de novo na ${queueName(p, l)}. Você entrará no final.`,
      url: '/',
    }),
    auto_rejoined: (p: Payload, l: Locale) => ({
      title: 'De volta à fila',
      body: `Seu plantão terminou e você voltou automaticamente para a ${queueName(p, l)} (nº ${p.position}).`,
      url: '/',
    }),
    moved_top3: (p: Payload, l: Locale) => ({
      title: `Você é o nº ${p.position} na ${queueName(p, l)}`,
      body: 'Você está entre os 3 primeiros. O próximo plantão pode ser seu.',
      url: '/',
    }),
    removed_from_queue: (p: Payload, l: Locale) => ({
      title: 'Removido da fila',
      body: `Um gestor removeu você da ${queueName(p, l)}. Motivo: ${p.reason ?? ''}`,
      url: '/',
    }),
    profession_changed: (p: Payload, l: Locale) => ({
      title: 'Sua profissão foi atualizada',
      body: `Um gestor definiu sua profissão como ${professionName(p.profession, l)}. Entre na sua nova fila pela tela inicial.`,
      url: '/',
    }),
    shift_short: (p: Payload, l: Locale) => ({
      title: 'Plantão sem equipe completa',
      body: `${fmtRange(p, l)}${unit(p)}: ${p.filled ?? 0} de ${p.slots} vagas preenchidas. As demais serão preenchidas automaticamente quando houver gente na ${queueName(p, l)}.`,
      url: `/admin/shifts/${p.shift_id}`,
    }),
    shift_started_short: (p: Payload, l: Locale) => ({
      title: 'Plantão começou incompleto',
      body: `${fmtRange(p, l)}${unit(p)} começou com ${p.filled ?? 0} de ${p.slots} vagas preenchidas.`,
      url: `/admin/shifts/${p.shift_id}`,
    }),
    shift_given_back: (p: Payload, l: Locale) => ({
      title: 'Um plantão foi devolvido',
      body: `${fmtRange(p, l)}${unit(p)}: a vaga foi para a próxima pessoa da ${queueName(p, l)}.`,
      url: `/admin/shifts/${p.shift_id}`,
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
  return `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#102A3A;background:#F7FAFC;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(r.title)}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 20px">${esc(r.body)}</p>
${link ? `<a href="${esc(link)}" style="display:inline-block;background:#0E7C86;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${cta}</a>` : ''}
</div></body></html>`;
}
