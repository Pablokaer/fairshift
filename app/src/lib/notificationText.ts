import type { TFunction } from 'i18next';
import { fmtRange, fmtTime } from './time';

type Payload = Record<string, unknown>;

/** In-app rendering of an inbox notification (mirrors the push/e-mail templates). */
export function renderNotification(type: string, payload: Payload, t: TFunction, locale: string) {
  const tz = (payload.org_timezone as string) || 'UTC';
  const vars = {
    queue: payload.queue_name ?? '',
    org: payload.org_name ?? '',
    range:
      payload.starts_at && payload.ends_at
        ? fmtRange(payload.starts_at as string, payload.ends_at as string, tz, locale)
        : '',
    time: payload.expires_at ? fmtTime(payload.expires_at as string, tz, locale) : '',
    position: payload.position ?? '',
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
    case 'offer_received':
    case 'offer_expiring':
      return p.offer_id ? `/offer/${p.offer_id}` : '/';
    case 'shift_assigned':
    case 'shift_updated':
    case 'no_show_recorded':
      return '/shifts';
    case 'eligible_to_rejoin':
    case 'auto_rejoined':
    case 'moved_top3':
    case 'auto_paused':
    case 'pool_added':
    case 'rejoin_allowed':
      return p.queue_id ? `/queue/${p.queue_id}` : '/';
    case 'shift_unfilled':
    case 'withdrawal':
      return p.shift_id ? `/admin/shifts/${p.shift_id}` : '/admin/shifts';
    default:
      return '/';
  }
}
