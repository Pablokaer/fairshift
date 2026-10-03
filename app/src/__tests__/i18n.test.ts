import fs from 'node:fs';
import path from 'node:path';
import en from '../i18n/locales/en.json';
import pt from '../i18n/locales/pt-BR.json';

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}

const enKeys = new Set(flatten(en as Tree));
const ptKeys = new Set(flatten(pt as Tree));
const has = (keys: Set<string>, key: string) => keys.has(key) || keys.has(`${key}_other`) || keys.has(`${key}_one`);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

function migrationSql(): string[] {
  const dir = path.join(__dirname, '../../../supabase/migrations');
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

// Codes and event types that only exist in functions dropped by FairShift v2
// (20261003000200_v2_schema.sql): offers, invites, pools, per-queue policies.
// Historical audit rows of these types still render, with their raw type.
const RETIRED = {
  errors: new Set([
    'invite.invalid_role', 'invite.invalid_expiry', 'invite.invalid_queue', 'invite.invalid_email', 'invite.not_found',
    'invite.revoked', 'invite.expired', 'invite.used_up', 'invite.email_mismatch', 'invite.member_deactivated',
    'queue.invalid_policy', 'queue.invalid_name', 'queue.lottery_already_drawn', 'queue.lottery_after_joins',
    'queue.has_open_shifts', 'queue.needs_approval', 'queue.cooldown', 'queue.pausing_disabled', 'shift.not_assigned',
    'offer.not_found', 'offer.not_open', 'offer.expired', 'offer.overlaps_assignment',
  ]),
  audit: new Set([
    'invite.created', 'invite.revoked', 'pool.member_added', 'pool.member_removed', 'entry.moved_to_end',
    'entry.auto_paused', 'queue.lottery_drawn', 'queue.updated', 'rejoin.approved', 'shift.reopened', 'shift.reoffered',
    'shift.no_show', 'offer.created', 'offer.expired', 'offer.accepted', 'assignment.withdrawn',
  ]),
  notifications: new Set([
    'pool_added', 'pool_removed', 'rejoin_allowed', 'offer_revoked', 'offer_received', 'offer_expired', 'offer_expiring',
    'shift_unfilled', 'auto_paused', 'no_show_recorded', 'withdrawal',
  ]),
};

describe('i18n', () => {
  it('en and pt-BR have exactly the same keys', () => {
    expect([...enKeys].filter((k) => !ptKeys.has(k))).toEqual([]);
    expect([...ptKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('every static key used in the code exists', () => {
    const src = path.join(__dirname, '..');
    const missing: string[] = [];
    for (const file of sourceFiles(src)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!has(enKeys, m[1])) missing.push(`${path.relative(src, file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every database error code has a translation', () => {
    const codes = new Set<string>();
    for (const sql of migrationSql()) {
      for (const m of sql.matchAll(/fail\('([a-z_.]+)'/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(30);
    expect([...codes].filter((c) => !RETIRED.errors.has(c) && !enKeys.has(`errors.${c}`))).toEqual([]);
  });

  it('every hook / sign-up error code has a translation', () => {
    for (const c of ['hospital_code.required', 'hospital_code.invalid', 'profession.invalid', 'queue.permanent'])
      expect(enKeys.has(`errors.${c}`)).toBe(true);
  });

  it('every audit event type and notification type has a label', () => {
    const sql = migrationSql().join('\n');
    const auditTypes = new Set([...sql.matchAll(/private\.audit\([^,]+,\s*'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]));
    expect([...auditTypes].filter((tpe) => !RETIRED.audit.has(tpe) && !enKeys.has(`audit_types.${tpe}`))).toEqual([]);
    const notifTypes = new Set(
      [...sql.matchAll(/private\.notify(?:_admins)?\([^;]*?'([a-z_0-9]+)',\s*(?:\n\s*)?(?:jsonb_build_object|private\.shift_payload|'\{\}')/g)].map(
        (m) => m[1],
      ),
    );
    expect(notifTypes.size).toBeGreaterThan(10);
    expect([...notifTypes].filter((n) => !RETIRED.notifications.has(n) && !enKeys.has(`notif.${n}.title`))).toEqual([]);
  });

  it('dynamic key families are complete', () => {
    for (const s of ['not_joined', 'waiting', 'paused', 'assigned', 'no_profession']) expect(enKeys.has(`states.${s}`)).toBe(true);
    for (const r of ['owner', 'admin', 'staff']) expect(enKeys.has(`roles.${r}`)).toBe(true);
    for (const s of ['draft', 'open', 'filled', 'completed', 'cancelled']) expect(enKeys.has(`shift_status.${s}`)).toBe(true);
    for (const a of ['active', 'completed', 'no_show', 'cancelled', 'withdrawn']) expect(enKeys.has(`assignment.${a}`)).toBe(true);
    for (const p of ['doctor', 'nurse']) {
      for (const ns of ['professions', 'professions_plural', 'queues', 'queue_in_sentence']) expect(enKeys.has(`${ns}.${p}`)).toBe(true);
      expect(has(enKeys, `home.waiting_${p}`)).toBe(true);
    }
    for (const k of ['deactivate', 'remove', 'remove_entry'])
      for (const suffix of ['', '_title', '_message']) expect(enKeys.has(`admin.${k}${suffix}`)).toBe(true);
    for (const s of ['open', 'drafts', 'history']) {
      expect(enKeys.has(`admin.no_${s}`)).toBe(true);
      expect(enKeys.has(`admin.scope_${s}_help`)).toBe(true);
    }
    for (const r of ['order', 'slots', 'after_shift', 'pause', 'cancel', 'give_back', 'no_reorder', 'privacy'])
      expect(enKeys.has(`rules.${r}`)).toBe(true);
    for (const g of ['manager', 'doctors', 'nurses']) expect(enKeys.has(`dev.groups.${g}`)).toBe(true);
  });
});
