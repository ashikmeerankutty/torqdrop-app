import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { InspectionRow } from '@/components/inspection/InspectionRow';
import { CarStatusCard } from '@/components/obd/CarStatusCard';
import { Banner } from '@/components/ui/Banner';
import { Brand } from '@/components/ui/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { PPI_V1 } from '@/lib/diagnostics/checklists/ppi-v1';
import { PPI_TOTAL } from '@/lib/firebase/inspections';
import { usePendingUploads } from '@/lib/firebase/upload-queue';
import { useInspections } from '@/lib/firebase/use-inspections';
import { usePreferences } from '@/lib/preferences';

/** Home leads with what the person picked at onboarding: inspections for inspectors, the car for owners. */
export default function HomeScreen() {
  const { mode } = usePreferences();
  const { colors } = useTheme();
  const inspections = useInspections();
  const pending = usePendingUploads();

  const open = (inspections ?? []).filter((i) => i.status !== 'complete');
  const done = (inspections ?? []).filter((i) => i.status === 'complete');
  const current = open[0];
  const recent = (inspections ?? []).filter((i) => i !== current).slice(0, 3);

  return (
    <Screen edgeToEdge>
      <View style={styles.header}>
        <Brand />
        <Text variant="body" tone="textMuted">
          {greeting()}
        </Text>
      </View>

      {pending > 0 && (
        <Banner tone="info" icon="upload" title={`${pending} photo${pending === 1 ? '' : 's'} waiting to upload`}>
          {"They're safe on this phone and upload automatically when you're online."}
        </Banner>
      )}

      {mode === 'owner' ? (
        <>
          <CarStatusCard />
          <Card onPress={() => router.push('/engine-check')} accent={colors.primary}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
                <Icon name="hearing" size={24} tone="primary" />
              </View>
              <View style={styles.grow}>
                <Text variant="bodyStrong">Strange engine noise?</Text>
                <Text variant="caption" tone="textMuted">
                  Film the engine for 20 seconds. AI listens for knocks, ticks, squeals and misfires.
                </Text>
              </View>
              <Icon name="chevron" size={20} tone="textSubtle" />
            </View>
          </Card>
          <Card onPress={() => router.push('/diagnose')}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
                <Icon name="ai" size={24} tone="primary" />
              </View>
              <View style={styles.grow}>
                <Text variant="bodyStrong">Something feels wrong?</Text>
                <Text variant="caption" tone="textMuted">
                  Describe a symptom or a warning code and get a plain-language explanation.
                </Text>
              </View>
              <Icon name="chevron" size={20} tone="textSubtle" />
            </View>
          </Card>
          <Card onPress={() => router.push('/inspection/new')}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: '#1E6FD926' }]}>
                <Icon name="inspections" size={24} color="#4B8FE8" />
              </View>
              <View style={styles.grow}>
                <Text variant="bodyStrong">Buying a used car?</Text>
                <Text variant="caption" tone="textMuted">
                  Walk through a full pre-purchase check, section by section.
                </Text>
              </View>
              <Icon name="chevron" size={20} tone="textSubtle" />
            </View>
          </Card>
        </>
      ) : (
        <>
          <NewInspectionHero />
          <View style={styles.stats}>
            <Stat label="In progress" value={inspections ? open.length : '–'} />
            <Stat label="Completed" value={inspections ? done.length : '–'} />
            <Stat label="To upload" value={pending} />
          </View>
        </>
      )}

      {current && (
        <View style={styles.section}>
          <Text variant="label" tone="textMuted">
            Continue where you left off
          </Text>
          <InspectionRow inspection={current} highlighted />
        </View>
      )}

      {recent.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text variant="label" tone="textMuted">
              Recent
            </Text>
            <Button title="See all" variant="ghost" onPress={() => router.navigate('/inspections')} style={styles.seeAll} />
          </View>
          {recent.map((i) => (
            <InspectionRow key={i.id} inspection={i} />
          ))}
        </View>
      )}

      {mode !== 'owner' && (
        <View style={styles.section}>
          <Text variant="label" tone="textMuted">
            OBD adapter
          </Text>
          <CarStatusCard compact />
          <Card onPress={() => router.push('/engine-check')}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
                <Icon name="hearing" size={22} tone="primary" />
              </View>
              <View style={styles.grow}>
                <Text variant="bodyStrong">Engine sound check</Text>
                <Text variant="caption" tone="textMuted">
                  Film the engine at idle and on a rev. AI listens for knocks, ticks and misfires, and checks for smoke.
                </Text>
              </View>
              <Icon name="chevron" size={20} tone="textSubtle" />
            </View>
          </Card>
        </View>
      )}
    </Screen>
  );
}

function NewInspectionHero() {
  const { colors } = useTheme();
  return (
    <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.heroGlow, { backgroundColor: colors.primarySoft }]} />
      <Text variant="title">Inspect a car</Text>
      <Text tone="textMuted">
        {PPI_TOTAL} checks in {PPI_V1.sections.length} sections, with photos, ECU scan and AI help. Works offline.
      </Text>
      <Button title="Start new inspection" icon="add" size="lg" onPress={() => router.push('/inspection/new')} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="metric">{value}</Text>
      <Text variant="caption" tone="textMuted">
        {label}
      </Text>
    </View>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const styles = StyleSheet.create({
  header: { gap: space.xs, marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 2 },
  badge: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: radius.xl, borderWidth: 1, padding: space.xl, gap: space.md, overflow: 'hidden' },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -90, right: -70 },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, borderRadius: radius.lg, borderWidth: 1, padding: space.md, gap: 2 },
  section: { gap: space.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { minHeight: 32, paddingVertical: 0, paddingHorizontal: space.sm },
});
