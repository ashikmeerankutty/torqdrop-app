import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import type { CarZone } from '@/lib/diagnostics/checklists/guides';

type Rect = { x: number; y: number; w: number; h: number; r?: number };

const W = 200;
const H = 344;

/** Top-down car, front at the top. RHS (driver's side in India) is on the right. */
const ZONES: Record<CarZone, Rect[]> = {
  bumper_front: [{ x: 46, y: 14, w: 108, h: 12, r: 6 }],
  hood: [{ x: 52, y: 28, w: 96, h: 66, r: 8 }],
  engine_bay: [{ x: 58, y: 34, w: 84, h: 54, r: 4 }],
  cross_member: [{ x: 58, y: 30, w: 84, h: 6, r: 2 }],
  apron_lhs: [{ x: 56, y: 38, w: 10, h: 52, r: 2 }],
  apron_rhs: [{ x: 134, y: 38, w: 10, h: 52, r: 2 }],
  fender_lhs: [{ x: 40, y: 30, w: 11, h: 64, r: 4 }],
  fender_rhs: [{ x: 149, y: 30, w: 11, h: 64, r: 4 }],
  windscreen: [{ x: 56, y: 97, w: 88, h: 18, r: 4 }],
  pillar_a_lhs: [{ x: 44, y: 96, w: 9, h: 16, r: 2 }],
  pillar_a_rhs: [{ x: 147, y: 96, w: 9, h: 16, r: 2 }],
  door_front_lhs: [{ x: 40, y: 114, w: 11, h: 56, r: 3 }],
  door_front_rhs: [{ x: 149, y: 114, w: 11, h: 56, r: 3 }],
  pillar_b_lhs: [{ x: 40, y: 171, w: 11, h: 7, r: 2 }],
  pillar_b_rhs: [{ x: 149, y: 171, w: 11, h: 7, r: 2 }],
  door_rear_lhs: [{ x: 40, y: 179, w: 11, h: 54, r: 3 }],
  door_rear_rhs: [{ x: 149, y: 179, w: 11, h: 54, r: 3 }],
  running_board_lhs: [{ x: 33, y: 114, w: 6, h: 119, r: 3 }],
  running_board_rhs: [{ x: 161, y: 114, w: 6, h: 119, r: 3 }],
  quarter_lhs: [{ x: 40, y: 234, w: 11, h: 48, r: 4 }],
  quarter_rhs: [{ x: 149, y: 234, w: 11, h: 48, r: 4 }],
  roof: [{ x: 56, y: 117, w: 88, h: 114, r: 6 }],
  floor: [{ x: 58, y: 136, w: 84, h: 92, r: 4 }],
  dashboard: [{ x: 58, y: 119, w: 84, h: 13, r: 4 }],
  obd_port: [{ x: 118, y: 133, w: 12, h: 6, r: 2 }],
  seats_front: [
    { x: 62, y: 144, w: 32, h: 30, r: 6 },
    { x: 106, y: 144, w: 32, h: 30, r: 6 },
  ],
  seats_rear: [{ x: 62, y: 188, w: 76, h: 32, r: 6 }],
  rear_glass: [{ x: 56, y: 233, w: 88, h: 15, r: 4 }],
  tailgate: [{ x: 52, y: 250, w: 96, h: 64, r: 8 }],
  boot: [{ x: 58, y: 256, w: 84, h: 52, r: 4 }],
  spare: [{ x: 84, y: 266, w: 32, h: 32, r: 16 }],
  bumper_rear: [{ x: 46, y: 316, w: 108, h: 12, r: 6 }],
  exhaust: [{ x: 58, y: 328, w: 10, h: 9, r: 3 }],
  wheel_fl: [{ x: 25, y: 42, w: 14, h: 42, r: 5 }],
  wheel_fr: [{ x: 161, y: 42, w: 14, h: 42, r: 5 }],
  wheel_rl: [{ x: 25, y: 250, w: 14, h: 42, r: 5 }],
  wheel_rr: [{ x: 161, y: 250, w: 14, h: 42, r: 5 }],
  mirror_lhs: [{ x: 26, y: 102, w: 14, h: 8, r: 3 }],
  mirror_rhs: [{ x: 160, y: 102, w: 14, h: 8, r: 3 }],
  underbody: [],
};

/** Always drawn, in this order, so the car reads as a car. The rest appear only when highlighted. */
const BASE: CarZone[] = [
  'hood',
  'roof',
  'tailgate',
  'bumper_front',
  'bumper_rear',
  'fender_lhs',
  'fender_rhs',
  'pillar_a_lhs',
  'pillar_a_rhs',
  'door_front_lhs',
  'door_front_rhs',
  'pillar_b_lhs',
  'pillar_b_rhs',
  'door_rear_lhs',
  'door_rear_rhs',
  'quarter_lhs',
  'quarter_rhs',
  'windscreen',
  'rear_glass',
  'dashboard',
  'seats_front',
  'seats_rear',
  'spare',
  'wheel_fl',
  'wheel_fr',
  'wheel_rl',
  'wheel_rr',
  'mirror_lhs',
  'mirror_rhs',
];

/** Where a check is on the car, highlighted in orange. */
export function CarMap({ zones, size = 1 }: { zones: CarZone[]; size?: number }) {
  const { colors } = useTheme();
  const lit = new Set(zones);
  const extra = zones.filter((z) => !BASE.includes(z));
  const draw = (zone: CarZone, highlighted: boolean) =>
    ZONES[zone].map((r, i) => (
      <View
        key={`${zone}-${i}`}
        style={{
          position: 'absolute',
          left: r.x * size,
          top: r.y * size,
          width: r.w * size,
          height: r.h * size,
          borderRadius: (r.r ?? 3) * size,
          borderWidth: 1,
          backgroundColor: highlighted ? colors.primary : zone.startsWith('wheel') ? colors.textSubtle : colors.surfaceRaised,
          borderColor: highlighted ? colors.primary : colors.border,
          opacity: highlighted ? 0.95 : 1,
        }}
      />
    ));

  return (
    <View style={styles.wrap} accessibilityLabel={`Car diagram highlighting ${zones.join(', ').replace(/_/g, ' ')}`}>
      <Text variant="label" tone="textSubtle">
        Front
      </Text>
      <View style={{ width: W * size, height: H * size }}>
        <View
          style={[
            styles.shell,
            {
              left: 40 * size,
              top: 20 * size,
              width: 120 * size,
              height: 304 * size,
              borderRadius: 28 * size,
              backgroundColor: colors.surface,
              borderColor: lit.has('underbody') ? colors.primary : colors.border,
              borderStyle: lit.has('underbody') ? 'dashed' : 'solid',
              borderWidth: lit.has('underbody') ? 3 : 1.5,
            },
          ]}
        />
        {BASE.flatMap((z) => draw(z, lit.has(z)))}
        {extra.flatMap((z) => draw(z, true))}
      </View>
      <View style={styles.legend}>
        <Text variant="caption" tone="textSubtle">
          LHS
        </Text>
        <Text variant="caption" tone="textSubtle">
          {lit.has('underbody') ? 'Underneath the car' : 'Seen from above'}
        </Text>
        <Text variant="caption" tone="textSubtle">
          RHS · driver
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  shell: { position: 'absolute' },
  legend: { flexDirection: 'row', justifyContent: 'space-between', width: 220 },
});
