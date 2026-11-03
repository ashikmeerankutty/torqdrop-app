import { type ComponentRef, type ReactNode, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, useTheme } from '@/components/Themed';
import { CarMap } from '@/components/inspection/CarMap';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Brand } from '@/components/ui/Brand';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { radius, space } from '@/constants/Theme';
import { PPI_TOTAL } from '@/lib/firebase/inspections';
import { setIntroSeen } from '@/lib/preferences';

/** First launch, before sign-in: who TorqDrop is for and what it does. Shown once per device. */
export default function IntroScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState(0);
  const last = page === SLIDES.length - 1;

  function next() {
    if (last) return setIntroSeen();
    pager.current?.scrollTo({ x: width * (page + 1), animated: true });
    setPage(page + 1);
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Brand />
        {!last && <Button title="Skip" variant="ghost" onPress={setIntroSeen} style={styles.skip} />}
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {SLIDES.map((s) => (
          <ScrollView key={s.title} style={{ width }} contentContainerStyle={styles.slide} showsVerticalScrollIndicator={false}>
            <View style={styles.visual}>{s.visual()}</View>
            <View style={styles.copy}>
              <Text variant="title">{s.title}</Text>
              <Text tone="textMuted" style={styles.body}>
                {s.body}
              </Text>
            </View>
          </ScrollView>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Pressable
              key={s.title}
              hitSlop={6}
              accessibilityLabel={`Page ${i + 1} of ${SLIDES.length}`}
              onPress={() => {
                pager.current?.scrollTo({ x: width * i, animated: true });
                setPage(i);
              }}
              style={[styles.dot, { backgroundColor: i === page ? colors.primary : colors.border, width: i === page ? 22 : 8 }]}
            />
          ))}
        </View>
        <Button title={last ? 'Get started' : 'Next'} icon={last ? undefined : 'forward'} size="lg" onPress={next} />
      </View>
    </View>
  );
}

function WhoFor() {
  const { colors } = useTheme();
  const who: [IconName, string, string][] = [
    ['engineer', 'Inspectors and garages', 'Run consistent pre-purchase inspections and hand over a professional report.'],
    ['inspections', 'Used-car dealers', 'Check stock before you buy it, and show buyers proof of condition.'],
    ['car', 'Buyers and owners', 'Know what you are buying, and understand warning lights on your own car.'],
  ];
  return (
    <View style={styles.stack}>
      {who.map(([icon, title, body]) => (
        <View key={title} style={[styles.whoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
            <Icon name={icon} size={22} tone="primary" />
          </View>
          <View style={styles.grow}>
            <Text variant="bodyStrong">{title}</Text>
            <Text variant="caption" tone="textMuted">
              {body}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function AiFindingMock() {
  const { colors } = useTheme();
  return (
    <MockFrame>
      <Text variant="caption" tone="textMuted">
        Body panels · Front door, RHS
      </Text>
      <View style={[styles.photoMock, { backgroundColor: colors.surfaceRaised }]}>
        <Icon name="camera" size={28} tone="textSubtle" />
      </View>
      <View style={[styles.findingMock, { backgroundColor: colors.surfaceRaised, borderLeftColor: STATUS_COLOR.attention }]}>
        <View style={styles.row}>
          <Icon name="ai" size={14} tone="primary" />
          <Text variant="caption" tone="textMuted" style={styles.grow}>
            AI suggestion · not verified
          </Text>
          <Pill label="Attention" color={STATUS_COLOR.attention} />
        </View>
        <Text variant="bodyStrong">Paint shade differs from the fender</Text>
        <Text variant="caption" tone="textMuted">
          May indicate a repaint. Check panel gaps and use a paint gauge.
        </Text>
        <View style={styles.row}>
          <Fake label="Confirm" icon="check" />
          <Fake label="Dismiss" icon="close" />
        </View>
      </View>
    </MockFrame>
  );
}

function ObdMock() {
  const { colors } = useTheme();
  const tiles: [string, string, string][] = [
    ['RPM', '820', ''],
    ['Coolant', '92', '°C'],
    ['Battery', '14.1', 'V'],
    ['Speed', '0', 'km/h'],
  ];
  return (
    <MockFrame>
      <View style={styles.tiles}>
        {tiles.map(([label, value, unit]) => (
          <View key={label} style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
            <Text variant="caption" tone="textMuted">
              {label}
            </Text>
            <Text variant="metric" style={styles.tileValue}>
              {value}
              <Text variant="caption" tone="textMuted">
                {' '}
                {unit}
              </Text>
            </Text>
          </View>
        ))}
      </View>
      <View style={[styles.row, styles.code, { backgroundColor: colors.surfaceRaised }]}>
        <Pill label="P0301" color={STATUS_COLOR.defect} />
        <Text variant="caption" style={styles.grow}>
          Cylinder 1 misfire: avoid driving until checked
        </Text>
      </View>
    </MockFrame>
  );
}

function EngineSoundMock() {
  const { colors } = useTheme();
  // A made-up waveform: idle, a rev in the middle, back to idle. Two ticks are marked.
  const bars = [3, 4, 3, 5, 9, 4, 3, 4, 6, 10, 14, 18, 16, 12, 7, 4, 3, 9, 4, 3, 4, 3];
  return (
    <MockFrame>
      <View style={styles.row}>
        <Icon name="hearing" size={16} tone="primary" />
        <Text variant="caption" tone="textMuted" style={styles.grow}>
          Engine sound check · 20 s
        </Text>
        <Text variant="caption" tone="textMuted">
          820 rpm
        </Text>
      </View>
      <View style={[styles.wave, { backgroundColor: colors.surfaceRaised }]}>
        {bars.map((h, i) => (
          <View
            key={i}
            style={[styles.waveBar, { height: h * 3, backgroundColor: i === 4 || i === 17 ? STATUS_COLOR.attention : colors.textSubtle }]}
          />
        ))}
      </View>
      <View style={[styles.findingMock, { backgroundColor: colors.surfaceRaised, borderLeftColor: STATUS_COLOR.attention }]}>
        <View style={styles.row}>
          <Icon name="ai" size={14} tone="primary" />
          <Text variant="caption" tone="textMuted" style={styles.grow}>
            Heard at 0:02 and 0:15
          </Text>
          <Pill label="Attention" color={STATUS_COLOR.attention} />
        </View>
        <Text variant="bodyStrong">Light ticking that follows engine speed</Text>
        <Text variant="caption" tone="textMuted">
          Often valve clearance or a low oil level. Check the oil first.
        </Text>
      </View>
    </MockFrame>
  );
}

function ReportMock() {
  const { colors } = useTheme();
  return (
    <MockFrame>
      <View style={[styles.verdict, { borderLeftColor: STATUS_COLOR.attention }]}>
        <Text variant="heading" style={{ color: STATUS_COLOR.attention }}>
          Issues found
        </Text>
        <View style={styles.row}>
          <Count n={1} label="defect" />
          <Count n={4} label="attention" />
          <Count n={2} label="not inspected" />
        </View>
      </View>
      {['Front bumper · Repainted', 'Tyre, front left · 2.4 mm'].map((line) => (
        <View key={line} style={[styles.row, styles.code, { backgroundColor: colors.surfaceRaised }]}>
          <Icon name="camera" size={14} tone="textMuted" />
          <Text variant="caption" style={styles.grow}>
            {line}
          </Text>
        </View>
      ))}
      <View style={styles.row}>
        <Fake label="Share link" icon="forward" />
        <Fake label="Save PDF" icon="documents" />
      </View>
    </MockFrame>
  );
}

function MockFrame({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.mock, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>;
}

function Fake({ label, icon }: { label: string; icon: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fake, { borderColor: colors.border }]}>
      <Icon name={icon} size={14} tone="textMuted" />
      <Text variant="caption" tone="textMuted">
        {label}
      </Text>
    </View>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <Text variant="caption" tone="textMuted">
      <Text variant="bodyStrong">{n}</Text> {label}
    </Text>
  );
}

const SLIDES: { title: string; body: string; visual: () => ReactNode }[] = [
  {
    title: 'Inspect used cars with confidence',
    body: 'TorqDrop is an inspection assistant for anyone who checks a car before money changes hands.',
    visual: () => <WhoFor />,
  },
  {
    title: `A guided ${PPI_TOTAL}-point inspection`,
    body: 'Section by section, with what to check and what to photograph, and where it is on the car. Everything saves on the phone, even with no signal.',
    visual: () => <CarMap zones={['apron_rhs', 'apron_lhs', 'wheel_fr', 'wheel_rl', 'floor', 'door_front_rhs']} size={0.8} />,
  },
  {
    title: 'AI checks your photos',
    body: 'It flags possible repaints, dents, leaks and flood signs, and reads the RC and insurance for you. You confirm or dismiss every suggestion.',
    visual: () => <AiFindingMock />,
  },
  {
    title: "Read the car's computer",
    body: 'Plug in a Bluetooth OBD adapter for live engine data and trouble codes in plain language, with safety warnings that never depend on AI.',
    visual: () => <ObdMock />,
  },
  {
    title: 'Let AI listen to your engine',
    body: 'Record a 20-second guided video. AI listens for knocks, ticks, squeals and misfires, and looks for smoke or leaks. With an adapter plugged in, it matches each sound to engine speed.',
    visual: () => <EngineSoundMock />,
  },
  {
    title: 'Reports buyers can trust',
    body: 'Every issue comes with its photo or reading. Sign off, then share a secure link or save a PDF.',
    visual: () => <ReportMock />,
  },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md },
  skip: { minHeight: 36, paddingVertical: 0 },
  slide: { padding: space.lg, gap: space.xl, flexGrow: 1, justifyContent: 'center' },
  visual: { alignItems: 'center' },
  copy: { gap: space.sm },
  body: { fontSize: 16, lineHeight: 23 },
  footer: { paddingHorizontal: space.lg, gap: space.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
  stack: { gap: space.sm, alignSelf: 'stretch' },
  whoCard: { flexDirection: 'row', gap: space.md, alignItems: 'center', borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  badge: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mock: { alignSelf: 'stretch', borderWidth: 1, borderRadius: radius.xl, padding: space.lg, gap: space.md },
  photoMock: { height: 110, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  findingMock: { borderLeftWidth: 4, borderRadius: radius.md, padding: space.md, gap: 6 },
  fake: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 6 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '47%', flexGrow: 1, borderRadius: radius.md, padding: space.md },
  tileValue: { fontSize: 24 },
  code: { borderRadius: radius.md, padding: space.md },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 72, borderRadius: radius.md, paddingHorizontal: space.md },
  waveBar: { width: 4, borderRadius: 2 },
  verdict: { borderLeftWidth: 5, paddingLeft: space.md, gap: 4 },
});
