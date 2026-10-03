import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Share, Text, View } from 'react-native';
import { useConfirm } from './Confirm';
import { Banner, Button, Card, Overline, Skeleton, Small } from './ui';
import { rpc, useHospitalCode } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { font, radius, space, useTheme } from '@/lib/theme';

/** Link that opens sign-up with the code already filled in. */
function signUpLink(code: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/sign-up?code=${encodeURIComponent(code)}`;
  }
  return Linking.createURL('/sign-up', { queryParams: { code } });
}

/** The hospital's permanent code, with Copy, Share and Regenerate (managers only). */
export function HospitalCodeCard() {
  const { t } = useTranslation();
  const c = useTheme();
  const confirm = useConfirm();
  const { current } = useOrg();
  const code = useHospitalCode(current?.org_id);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const value = code.data?.join_code ?? '';

  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setMsg({ kind: 'success', text: t('admin.code_copied') });
  };

  const share = async () => {
    const message = t('admin.code_share_message', { hospital: current?.org.name, code: value, link: signUpLink(value) });
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
        if (nav?.share) await nav.share({ text: message });
        else {
          await Clipboard.setStringAsync(message);
          setMsg({ kind: 'success', text: t('admin.code_share_copied') });
        }
      } else {
        await Share.share({ message });
      }
    } catch {
      /* the person closed the share sheet */
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: t('admin.code_regenerate_title'),
      message: t('admin.code_regenerate_message'),
      confirmLabel: t('admin.code_regenerate'),
      destructive: true,
    });
    if (!ok || !current) return;
    setBusy(true);
    setMsg(null);
    try {
      await rpc('regenerate_join_code', { p_org: current.org_id });
      await code.refetch();
      setMsg({ kind: 'success', text: t('admin.code_regenerated') });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="tint">
      <Overline>{t('admin.code_title')}</Overline>
      {code.isLoading ? (
        <Skeleton height={48} width="60%" style={{ marginVertical: space.sm }} />
      ) : (
        <View
          accessible
          accessibilityLabel={t('admin.code_a11y', { code: value.split('').join(' ') })}
          style={{ marginVertical: space.sm, alignSelf: 'flex-start', backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm }}
        >
          <Text testID="hospital-code" selectable style={{ fontFamily: font.extrabold, fontSize: 34, letterSpacing: 4, color: c.primaryStrong }}>
            {value}
          </Text>
        </View>
      )}
      <Small style={{ marginBottom: space.md }}>{t('admin.code_help')}</Small>
      {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button testID="copy-code" title={t('admin.code_copy')} icon="copy-outline" onPress={copy} disabled={!value} style={{ flexGrow: 1 }} />
        <Button testID="share-code" title={t('admin.code_share')} icon="share-social-outline" variant="secondary" onPress={share} disabled={!value} style={{ flexGrow: 1 }} />
        <Button
          testID="regenerate-code"
          title={t('admin.code_regenerate')}
          icon="refresh-outline"
          variant="ghost"
          onPress={regenerate}
          loading={busy}
          style={{ flexGrow: 1 }}
        />
      </View>
    </Card>
  );
}
