import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, useTheme } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { radius, space } from '@/constants/Theme';
import type { Guide } from '@/lib/diagnostics/checklists/guides';

import { CarMap } from './CarMap';
import { GUIDE_SAMPLES } from './guide-samples';

interface Props {
  /** Null hides the sheet. */
  guide: { title: string; guide: Guide; itemKey?: string } | null;
  onClose: () => void;
}

/** Bottom sheet: where the check is on the car, what to look for, what photo to take, and samples. */
export function GuideSheet({ guide, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const samples = guide?.itemKey ? (GUIDE_SAMPLES[guide.itemKey] ?? []) : [];

  return (
    <Modal visible={!!guide} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close guide" />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.md }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        {guide && (
          <ScrollView contentContainerStyle={styles.content}>
            <Text variant="title">{guide.title}</Text>

            {!!guide.guide.zones?.length && (
              <View style={[styles.mapCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <CarMap zones={guide.guide.zones} size={0.9} />
              </View>
            )}

            <Section icon="search" title="What to check" body={guide.guide.check} />
            {guide.guide.capture && <Section icon="camera" title="What to capture" body={guide.guide.capture} />}

            {samples.length > 0 && (
              <>
                <Text variant="label" tone="textMuted">
                  Examples
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.samples}>
                  {samples.map((s, i) => (
                    <View key={i} style={styles.sample}>
                      <Image source={s.source} style={styles.sampleImage} resizeMode="cover" />
                      <Text variant="caption" tone="textMuted">
                        {s.caption}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
          </ScrollView>
        )}
        <View style={styles.footer}>
          <Button title="Got it" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Section({ icon, title, body }: { icon: 'search' | 'camera'; title: string; body: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Icon name={icon} size={18} tone="primary" />
        <Text variant="bodyStrong">{title}</Text>
      </View>
      <Text tone="textMuted" style={styles.body}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: space.sm },
  content: { padding: space.lg, gap: space.lg },
  mapCard: { borderWidth: 1, borderRadius: radius.lg, paddingVertical: space.md, alignItems: 'center' },
  section: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  body: { lineHeight: 22 },
  samples: { gap: space.md },
  sample: { width: 220, gap: 4 },
  sampleImage: { width: 220, height: 160, borderRadius: radius.md },
  footer: { paddingHorizontal: space.lg },
});
