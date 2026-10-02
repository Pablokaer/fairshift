import { addDays } from './time';

export interface Draft {
  date: string;
  start: string;
  end: string;
  unit: string;
  notes: string;
}

/** Expand the form into the list of shifts to create (single or repeated). */
export function expandShifts(base: Draft, mode: 'single' | 'bulk', repeatDays: number, everyNDays: number, weekdaysOnly: boolean) {
  if (mode === 'single') return [base];
  const out: Draft[] = [];
  let d = base.date;
  let guard = 0;
  while (out.length < repeatDays && guard < 400) {
    guard++;
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (!weekdaysOnly || (dow !== 0 && dow !== 6)) out.push({ ...base, date: d });
    d = addDays(d, everyNDays);
  }
  return out;
}

