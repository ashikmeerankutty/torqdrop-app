import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, useTheme } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { radius, space } from '@/constants/Theme';
import { registrationMismatch, type ScannedAnswer, scanToAnswers } from '@/lib/diagnostics/document-fields';
import type { DocumentKind, DocumentScan } from '@/lib/schemas/document';

export type ScanState =
  | { phase: 'reading'; kind: DocumentKind }
  | { phase: 'error'; kind: DocumentKind; message: string }
  | { phase: 'result'; kind: DocumentKind; scan: DocumentScan };

interface Props {
  state: ScanState | null;
  /** Current answers by "section/item", to show what a scan would replace. */
  current: Record<string, string | undefined>;
  carRegNo?: string;
  onApply: (answers: ScannedAnswer[]) => void;
  onRetake: () => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const NAME: Record<DocumentKind, string> = { rc: 'RC', insurance: 'insurance policy' };

/** Shows what the AI read from a document; the inspector picks which answers to fill in. */
export function ScanSheet({ state, current, carRegNo, onApply, onRetake, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const result = state?.phase === 'result' ? scanToAnswers(state.scan, today()) : null;
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const keyOf = (a: ScannedAnswer) => `${a.sectionKey}/${a.itemKey}`;
  const selected = result?.answers.filter((a) => !unticked.has(keyOf(a))) ?? [];
  const mismatch = state?.phase === 'result' ? registrationMismatch(state.scan, carRegNo) : null;

  function close() {
    setUnticked(new Set());
    onClose();
  }

  return (
    <Modal visible={!!state} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={state?.phase === 'reading' ? undefined : close} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.md }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        {state?.phase === 'reading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text tone="textMuted">Reading the {NAME[state.kind]}…</Text>
          </View>
        )}

        {state?.phase === 'error' && (
          <View style={styles.content}>
            <Banner tone="warning" title="Couldn't read it">
              {state.message}
            </Banner>
            <Button title="Try again" icon="camera" onPress={onRetake} />
            <Button title="Cancel" variant="ghost" onPress={close} />
          </View>
        )}

        {state?.phase === 'result' && result && (
          <>
            <ScrollView contentContainerStyle={styles.content}>
              <Text variant="title">From the {NAME[state.kind]}</Text>
              {!state.scan.readable || result.answers.length === 0 ? (
                <Banner tone="warning" title="Nothing readable">
                  {state.scan.problem ?? 'Retake the photo flat, in good light, with the whole document in frame.'}
                </Banner>
              ) : (
                <Text variant="caption" tone="textMuted">
                  {"Check each value against the document. Untick anything that's wrong; you can still edit answers afterwards."}
                </Text>
              )}
              {mismatch && (
                <Banner tone="danger" title="Different vehicle">
                  {mismatch}
                </Banner>
              )}

              {result.answers.map((a) => {
                const key = keyOf(a);
                const on = !unticked.has(key);
                const existing = current[key];
                const replaces = existing && existing !== a.display ? existing : null;
                return (
                  <Pressable
                    key={key}
                    onPress={() =>
                      setUnticked((set) => {
                        const next = new Set(set);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: on ? colors.primary : colors.textSubtle, backgroundColor: on ? colors.primary : 'transparent' },
                      ]}>
                      {on && <Icon name="check" size={14} color={colors.onPrimary} />}
                    </View>
                    <View style={styles.grow}>
                      <Text variant="caption" tone="textMuted">
                        {a.label}
                      </Text>
                      <Text variant="bodyStrong">{a.display}</Text>
                      {replaces && (
                        <Text variant="caption" tone="danger">
                          Replaces “{replaces}”
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}

              {result.references.length > 0 && (
                <View style={[styles.refs, { backgroundColor: colors.surfaceRaised }]}>
                  {result.references.map((r) => (
                    <View key={r.label}>
                      <Text variant="caption" tone="textMuted">
                        {r.label}
                      </Text>
                      <Text variant="bodyStrong" selectable>
                        {r.value}
                      </Text>
                      {r.note && (
                        <Text variant="caption" tone="textSubtle">
                          {r.note}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
            <View style={styles.footer}>
              <Button
                title={selected.length ? `Fill in ${selected.length} answer${selected.length === 1 ? '' : 's'}` : 'Nothing selected'}
                icon="check"
                disabled={!selected.length}
                onPress={() => {
                  onApply(selected);
                  setUnticked(new Set());
                }}
              />
              <View style={styles.footerRow}>
                <Button title="Retake" variant="ghost" icon="camera" onPress={onRetake} style={styles.grow} />
                <Button title="Cancel" variant="ghost" onPress={close} style={styles.grow} />
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: space.sm },
  center: { alignItems: 'center', gap: space.md, padding: space.xxl },
  content: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.md, padding: space.md },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  refs: { borderRadius: radius.md, padding: space.md, gap: space.md },
  footer: { paddingHorizontal: space.lg, gap: space.xs },
  footerRow: { flexDirection: 'row', gap: space.sm },
});
