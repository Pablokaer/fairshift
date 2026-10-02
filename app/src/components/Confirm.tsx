// Cross-platform confirmation dialog (Alert.alert does not work on web).
// Supports an optional required text input, e.g. a written removal reason.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { radius, space, useTheme } from '@/lib/theme';
import { Body, Button, Field, H2 } from './ui';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  input?: { label: string; minLength?: number; placeholder?: string; multiline?: boolean };
  extra?: ReactNode;
}

type Resolver = (value: string | boolean) => void;

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<string | boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const c = useTheme();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState('');
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setText('');
    setOpts(o);
    return new Promise<string | boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: string | boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  };

  const minLength = opts?.input?.minLength ?? 0;
  const inputOk = !opts?.input || text.trim().length >= minLength;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal visible={!!opts} transparent animationType="fade" onRequestClose={() => close(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.cancel')} onPress={() => close(false)} />
          {opts ? (
            <View
              accessibilityViewIsModal
              accessibilityRole="alert"
              style={[styles.dialog, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <H2 style={{ marginTop: 0 }}>{opts.title}</H2>
              <Body style={{ marginBottom: space.md }}>{opts.message}</Body>
              {opts.extra}
              {opts.input ? (
                <Field
                  label={opts.input.label}
                  value={text}
                  onChangeText={setText}
                  placeholder={opts.input.placeholder}
                  multiline={opts.input.multiline}
                  autoFocus
                  error={text.length > 0 && !inputOk ? t('common.min_chars', { count: minLength }) : null}
                />
              ) : null}
              <View style={styles.actions}>
                <Button
                  title={opts.cancelLabel ?? t('common.cancel')}
                  variant="secondary"
                  onPress={() => close(false)}
                  style={{ flex: 1 }}
                />
                <Button
                  testID="confirm-dialog-confirm"
                  title={opts.confirmLabel}
                  variant={opts.destructive ? 'danger' : 'primary'}
                  disabled={!inputOk}
                  onPress={() => close(opts.input ? text.trim() : true)}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.lg },
  dialog: { borderRadius: radius.lg, borderWidth: 1, padding: space.xl, width: '100%', maxWidth: 520, alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
});
