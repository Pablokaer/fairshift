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

/** Duration in whole minutes between two instants, never negative. */
export function minutesBetween(a: number, b: number) {
  return Math.max(0, Math.floor((b - a) / 60_000));
}

/** mm:ss or h:mm:ss for a countdown. */
export function fmtCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
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

/** Postgres interval text ("00:30:00", "1 day 02:00:00") -> minutes. */
export function intervalMinutes(v: string | null | undefined): number {
  if (!v) return 0;
  let minutes = 0;
  const days = /(-?\d+) days?/.exec(v);
  if (days) minutes += Number(days[1]) * 1440;
  const hms = /(-?\d+):(\d{2}):(\d{2})/.exec(v);
  if (hms) minutes += Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60;
  return minutes;
}
