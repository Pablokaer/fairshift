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
    const migrations = path.join(__dirname, '../../../supabase/migrations');
    const codes = new Set<string>();
    for (const f of fs.readdirSync(migrations)) {
      const sql = fs.readFileSync(path.join(migrations, f), 'utf8');
      for (const m of sql.matchAll(/fail\('([a-z_.]+)'/g)) codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(30);
    expect([...codes].filter((c) => !enKeys.has(`errors.${c}`))).toEqual([]);
  });

  it('every audit event type and notification type has a label', () => {
    const migrations = path.join(__dirname, '../../../supabase/migrations');
    const sql = fs.readdirSync(migrations).map((f) => fs.readFileSync(path.join(migrations, f), 'utf8')).join('\n');
    const auditTypes = new Set([...sql.matchAll(/private\.audit\([^,]+,\s*'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]));
    ['offer.declined', 'offer.revoked'].forEach((x) => auditTypes.add(x));
    expect([...auditTypes].filter((tpe) => !enKeys.has(`audit_types.${tpe}`))).toEqual([]);
    const notifTypes = new Set(
      [...sql.matchAll(/private\.notify(?:_admins)?\([^;]*?'([a-z_0-9]+)',\s*(?:\n\s*)?(?:jsonb_build_object|private\.shift_payload|'\{\}')/g)].map((m) => m[1]),
    );
    expect(notifTypes.size).toBeGreaterThan(10);
    expect([...notifTypes].filter((n) => !enKeys.has(`notif.${n}.title`))).toEqual([]);
  });

  it('dynamic key families are complete', () => {
    for (const s of ['not_joined', 'waiting', 'paused', 'offered', 'assigned']) expect(enKeys.has(`states.${s}`)).toBe(true);
    for (const r of ['owner', 'admin', 'staff']) expect(enKeys.has(`roles.${r}`)).toBe(true);
    for (const s of ['draft', 'published', 'offered', 'assigned', 'completed', 'no_show', 'cancelled', 'unfilled'])
      expect(enKeys.has(`shift_status.${s}`)).toBe(true);
    for (const p of ['rejoin_end', 'cooldown', 'admin_approval']) expect(enKeys.has(`rules.no_show_${p}`)).toBe(true);
    for (const o of ['accepted', 'declined', 'expired', 'revoked']) expect(enKeys.has(`offer.outcome_${o}`)).toBe(true);
  });
});
