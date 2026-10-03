import { notificationUrl } from '../lib/notificationText';
import { addDays, fmtRange, fmtTime, isHm, isYmd } from '../lib/time';

describe('time utils', () => {
  it('formats in the hospital timezone, not the device timezone', () => {
    // 10:00 UTC is 07:00 in São Paulo and 11:00 in Dublin (summer).
    expect(fmtTime('2026-07-01T10:00:00Z', 'America/Sao_Paulo', 'en-GB')).toBe('07:00');
    expect(fmtTime('2026-07-01T10:00:00Z', 'Europe/Dublin', 'en-GB')).toBe('11:00');
  });
  it('formats an overnight range in the hospital timezone', () => {
    expect(fmtRange('2026-07-01T22:00:00Z', '2026-07-02T10:00:00Z', 'America/Sao_Paulo', 'en-GB')).toMatch(/19:00–07:00$/);
  });
  it('validates and adds dates', () => {
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2026-2-28')).toBe(false);
    expect(isHm('07:00')).toBe(true);
    expect(isHm('24:00')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('notification deep links', () => {
  it('routes an assignment to My shifts', () => expect(notificationUrl('shift_assigned', {})).toBe('/shifts'));
  it('routes rejoin prompts to the home screen', () => expect(notificationUrl('eligible_to_rejoin', { queue_id: 'q' })).toBe('/'));
  it('routes manager alerts to the shift', () => expect(notificationUrl('shift_short', { shift_id: 's' })).toBe('/admin/shifts/s'));
});
