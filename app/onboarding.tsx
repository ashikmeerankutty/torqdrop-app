import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Brand } from '@/components/ui/Brand';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { setMode, type UsageMode } from '@/lib/preferences';

const OPTIONS: { mode: UsageMode; icon: IconName; title: string; body: string; points: string[] }[] = [
  {
    mode: 'inspector',
    icon: 'engineer',
    title: 'I inspect cars',
    body: 'For inspectors, garages and dealers checking cars for buyers.',
    points: ['200-point pre-purchase checklist', 'Photo evidence with AI help', 'ECU scan and engine sound check'],
  },
  {
    mode: 'owner',
    icon: 'car',
    title: 'I want to check my car',
    body: 'For owners and buyers who want to understand a car.',
    points: [
      'Live engine data while you drive',
      'Trouble codes in plain language',
      'AI listens to your engine for faults',
      'Inspect a car before you buy',
    ],
  },
];

/** First run after sign-in: the choice decides what the home screen leads with. */
export default function OnboardingScreen() {
  const { colors } = useTheme();
  const [choice, setChoice] = useState<UsageMode | null>(null);

  return (
    <Screen
      edgeToEdge
      footer={
        <>
          <Button title="Continue" size="lg" disabled={!choice} onPress={() => choice && setMode(choice)} />
          <Text variant="caption" tone="textSubtle" style={styles.center}>
            You can switch any time in Account.
          </Text>
        </>
      }>
      <Brand />
      <View style={styles.intro}>
        <Text variant="title">How will you use TorqDrop?</Text>
        <Text tone="textMuted">{"We'll set up the app around what you do most."}</Text>
      </View>

      {OPTIONS.map((o) => {
        const selected = choice === o.mode;
        return (
          <Pressable
            key={o.mode}
            onPress={() => setChoice(o.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[
              styles.option,
              {
                backgroundColor: selected ? colors.primarySoft : colors.surface,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}>
            <View style={styles.optionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: selected ? colors.primary : colors.surfaceRaised }]}>
                <Icon name={o.icon} size={26} color={selected ? colors.onPrimary : colors.text} />
              </View>
              <View style={styles.grow}>
                <Text variant="heading">{o.title}</Text>
                <Text variant="caption" tone="textMuted">
                  {o.body}
                </Text>
              </View>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.textSubtle }]}>
                {selected && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
              </View>
            </View>
            <View style={styles.points}>
              {o.points.map((p) => (
                <View key={p} style={styles.point}>
                  <Icon name="check" size={16} tone={selected ? 'primary' : 'textSubtle'} />
                  <Text variant="caption" tone="textMuted">
                    {p}
                  </Text>
                </View>
              ))}
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.sm, marginTop: space.md },
  center: { textAlign: 'center' },
  option: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconBadge: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  points: { gap: 6, paddingLeft: 60 },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
