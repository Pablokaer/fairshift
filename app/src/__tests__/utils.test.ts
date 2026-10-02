import { notificationUrl } from '../lib/notificationText';
import { expandShifts } from '../lib/shifts';
import { addDays, fmtCountdown, fmtTime, intervalMinutes, isHm, isYmd } from '../lib/time';

describe('time utils', () => {
  it('formats in the organization timezone, not the device timezone', () => {
    // 10:00 UTC is 07:00 in São Paulo and 11:00 in Dublin (summer).
    expect(fmtTime('2026-07-01T10:00:00Z', 'America/Sao_Paulo', 'en-GB')).toBe('07:00');
    expect(fmtTime('2026-07-01T10:00:00Z', 'Europe/Dublin', 'en-GB')).toBe('11:00');
  });
  it('countdown', () => {
    expect(fmtCountdown(30 * 60_000)).toBe('30:00');
    expect(fmtCountdown(61_000)).toBe('01:01');
    expect(fmtCountdown(3_600_000 + 5000)).toBe('1:00:05');
    expect(fmtCountdown(-5)).toBe('00:00');
  });
  it('parses Postgres intervals', () => {
    expect(intervalMinutes('00:30:00')).toBe(30);
    expect(intervalMinutes('1 day 02:00:00')).toBe(1560);
    expect(intervalMinutes('2 days')).toBe(2880);
    expect(intervalMinutes(null)).toBe(0);
  });
  it('validates and adds dates', () => {
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2026-2-28')).toBe(false);
    expect(isHm('07:00')).toBe(true);
    expect(isHm('24:00')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('bulk shift expansion', () => {
  const base = { date: '2026-10-09', start: '07:00', end: '19:00', unit: 'ICU', notes: '' }; // a Friday
  it('single', () => expect(expandShifts(base, 'single', 5, 1, false)).toHaveLength(1));
  it('every day', () => expect(expandShifts(base, 'bulk', 3, 1, false).map((d) => d.date)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']));
  it('weekdays only skips the weekend', () =>
    expect(expandShifts(base, 'bulk', 3, 1, true).map((d) => d.date)).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']));
  it('every 2 days', () => expect(expandShifts(base, 'bulk', 2, 2, false).map((d) => d.date)).toEqual(['2026-10-09', '2026-10-11']));
});

describe('notification deep links', () => {
  it('routes offers to the offer screen', () => expect(notificationUrl('offer_received', { offer_id: 'x' })).toBe('/offer/x'));
  it('routes rejoin to the queue', () => expect(notificationUrl('eligible_to_rejoin', { queue_id: 'q' })).toBe('/queue/q'));
});
