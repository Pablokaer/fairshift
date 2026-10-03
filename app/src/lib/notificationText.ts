import type { TFunction } from 'i18next';
import { fmtRange } from './time';

type Payload = Record<string, unknown>;

/** In-app rendering of an inbox notification (mirrors the push/e-mail templates). */
export function renderNotification(type: string, payload: Payload, t: TFunction, locale: string) {
  const tz = (payload.org_timezone as string) || 'UTC';
  const profession = payload.profession === 'nurse' ? 'nurse' : 'doctor';
  const vars = {
    queue: t(`queue_in_sentence.${profession}`),
    profession: t(`professions.${profession}`),
    range:
      payload.starts_at && payload.ends_at
        ? fmtRange(payload.starts_at as string, payload.ends_at as string, tz, locale)
        : '',
    unit: payload.unit ? ` · ${payload.unit}` : '',
    position: payload.position ?? '',
    filled: payload.filled ?? 0,
    slots: payload.slots ?? '',
    reason: payload.reason ?? '',
  };
  const key = `notif.${type}`;
  return {
    title: t(`${key}.title`, { ...vars, defaultValue: type }),
    body: t(`${key}.body`, { ...vars, defaultValue: '' }),
    url: notificationUrl(type, payload),
  };
}

export function notificationUrl(type: string, p: Payload): string | null {
  switch (type) {
    case 'shift_assigned':
    case 'shift_updated':
      return '/shifts';
    case 'shift_short':
    case 'shift_started_short':
    case 'shift_given_back':
      return p.shift_id ? `/admin/shifts/${p.shift_id}` : '/admin/shifts';
    default:
      return '/';
  }
}
