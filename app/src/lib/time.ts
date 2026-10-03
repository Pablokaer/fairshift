// All timestamps come from the server in UTC; they are displayed in the
// organization's timezone (never the device's).
export function fmtDate(iso: string | null | undefined, tz: string, locale: string, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', ...opts }).format(
      new Date(iso),
    );
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

export function fmtTime(iso: string | null | undefined, tz: string, locale: string) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

export function fmtDateTime(iso: string | null | undefined, tz: string, locale: string) {
  if (!iso) return '';
  return `${fmtDate(iso, tz, locale)} ${fmtTime(iso, tz, locale)}`;
}

export function fmtRange(startIso: string, endIso: string, tz: string, locale: string) {
  return `${fmtDate(startIso, tz, locale)}, ${fmtTime(startIso, tz, locale)}–${fmtTime(endIso, tz, locale)}`;
}

/** "YYYY-MM-DD" for today in a timezone. */
export function todayIn(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
    return parts;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isHm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
