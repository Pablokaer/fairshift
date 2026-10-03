// Development-only dropdown to jump between the seeded demo accounts without
// going through the sign-in screen. Renders nothing unless DEV_ACCOUNT_SWITCHER_ENABLED.
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { DEV_ACCOUNT_GROUPS, DEV_ACCOUNT_SWITCHER_ENABLED, DEV_PASSWORD, type DevAccount } from '@/lib/devAccounts';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';
import { Small } from './ui';

export function DevAccountSwitcher() {
  if (!DEV_ACCOUNT_SWITCHER_ENABLED) return null;
  return <Switcher />;
}

function Switcher() {
  const { t } = useTranslation();
  const c = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = session?.user.email ?? '';
  const currentAccount = DEV_ACCOUNT_GROUPS.flatMap((g) => g.accounts).find((a) => a.email === email);

  const switchTo = async (account: DevAccount) => {
    setOpen(false);
    if (account.email === email) return;
    setBusy(true);
    setError(null);
    // signInWithPassword replaces the session in place (no SIGNED_OUT), so the
    // app stays on this screen. Then drop the old user's queries (refetching
    // them as the new user would hit RLS) and refetch everything else.
    const oldUserId = session?.user.id;
    const { error: err } = await supabase.auth.signInWithPassword({ email: account.email, password: DEV_PASSWORD });
    if (err) setError(errorMessage(err));
    else {
      qc.removeQueries({ predicate: (q) => !!oldUserId && q.queryKey.includes(oldUserId) });
      await qc.resetQueries();
    }
    setBusy(false);
  };

  return (
    <View style={[styles.box, { borderColor: c.warning, backgroundColor: c.surface }]}>
      <Small style={{ fontWeight: '700', color: c.warning }}>{t('dev.title')}</Small>
      <Pressable
        testID="dev-account-switcher"
        accessibilityRole="combobox"
        accessibilityLabel={t('dev.switch_account')}
        accessibilityValue={{ text: email }}
        accessibilityState={{ expanded: open, busy }}
        disabled={busy}
        onPress={() => setOpen(true)}
        style={[styles.trigger, { borderColor: c.border, backgroundColor: c.bg }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {currentAccount?.name ?? email}
          </Text>
          <Text style={[styles.email, { color: c.textMuted }]} numberOfLines={1}>
            {email}
          </Text>
        </View>
        {busy ? <ActivityIndicator color={c.primary} /> : <Ionicons name="chevron-down" size={20} color={c.primary} />}
      </Pressable>
      {error ? <Small style={{ color: c.danger, marginTop: space.xs }}>{error}</Small> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.cancel')} onPress={() => setOpen(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <ScrollView>
              {DEV_ACCOUNT_GROUPS.map((group) => (
                <View key={group.key}>
                  <Text accessibilityRole="header" style={[styles.groupTitle, { color: c.textMuted }]}>
                    {t(`dev.groups.${group.key}`)}
                  </Text>
                  {group.accounts.map((a) => {
                    const selected = a.email === email;
                    return (
                      <Pressable
                        key={a.email}
                        testID={`dev-account-${a.email}`}
                        accessibilityRole="menuitem"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${a.name}, ${a.email}`}
                        onPress={() => switchTo(a)}
                        style={({ pressed }) => [
                          styles.option,
                          { borderColor: c.border, backgroundColor: selected ? c.surfaceAlt : pressed ? c.bg : 'transparent' },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.name, { color: c.text }]}>
                            {a.name}
                            {a.note ? <Text style={{ color: c.textMuted, fontWeight: '400' }}> · {t(`dev.notes.${a.note}`)}</Text> : null}
                          </Text>
                          <Text style={[styles.email, { color: c.textMuted }]}>{a.email}</Text>
                        </View>
                        {selected ? <Ionicons name="checkmark" size={20} color={c.primary} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md, padding: space.sm, marginBottom: space.md, gap: space.xs },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  name: { fontSize: 15, fontWeight: '700' },
  email: { fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.lg },
  sheet: { borderRadius: radius.lg, borderWidth: 1, width: '100%', maxWidth: 520, maxHeight: '85%', alignSelf: 'center', overflow: 'hidden' },
  groupTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
