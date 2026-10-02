import i18n from '@/i18n';

/** Map a Supabase/Postgres error to a translated, human-readable message. */
export function errorMessage(err: unknown): string {
  const raw = (err as { message?: string } | null)?.message ?? String(err ?? '');
  const code = raw.trim();
  if (/^[a-z_]+\.[a-z_]+$/.test(code)) {
    const key = `errors.${code}`;
    if (i18n.exists(key)) return i18n.t(key);
  }
  if (/network|fetch/i.test(raw)) return i18n.t('errors.network');
  if (/Invalid login credentials/i.test(raw)) return i18n.t('errors.auth.invalid_credentials');
  if (/User already registered/i.test(raw)) return i18n.t('errors.auth.already_registered');
  if (/Password should be/i.test(raw)) return i18n.t('errors.auth.weak_password');
  if (/Token has expired|invalid/i.test(raw) && /otp|token/i.test(raw)) return i18n.t('errors.auth.invalid_code');
  return i18n.t('errors.generic');
}
