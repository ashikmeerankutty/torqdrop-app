import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';

const SWEEP = 270;
const START = 135;

const rad = (deg: number) => (deg * Math.PI) / 180;
const point = (c: number, r: number, deg: number) => [c + r * Math.cos(rad(deg)), c + r * Math.sin(rad(deg))] as const;

function arc(c: number, r: number, a0: number, a1: number) {
  const [x0, y0] = point(c, r, a0);
  const [x1, y1] = point(c, r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** A round step giving about `target` major ticks. */
export function niceStep(range: number, target = 8): number {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

interface Props {
  value: number | null | undefined;
  min: number;
  max: number;
  size: number;
  label: string;
  unit: string;
  decimals: number;
  /** Values from here to max are drawn red. */
  redFrom?: number;
  /** Highest value seen, marked on the dial. */
  peak?: number | null;
  /** Override the colours (HUD mode). */
  color?: string;
  mutedColor?: string;
}

/** A dial with a needle. The needle animates on the UI thread, so it stays smooth between readings. */
export const AnalogGauge = memo(function AnalogGauge({ value, min, max, size, label, unit, decimals, redFrom, peak, color, mutedColor }: Props) {
  const { colors } = useTheme();
  const fg = color ?? colors.text;
  const muted = mutedColor ?? colors.textMuted;
  const c = size / 2;
  const r = c - 8;
  const span = max - min;
  const angleOf = (v: number) => START + (Math.max(0, Math.min(1, (v - min) / span)) * SWEEP);
  // Large ranges (rpm) are labelled in thousands.
  const divisor = max >= 2000 ? 1000 : 1;

  const ticks = useMemo(() => {
    const step = niceStep(span);
    const out: { v: number; major: boolean }[] = [];
    const first = Math.ceil(min / step) * step;
    for (let v = first; v <= max + 1e-9; v += step) {
      out.push({ v, major: true });
      const half = v + step / 2;
      if (half < max) out.push({ v: half, major: false });
    }
    return out;
  }, [min, max, span]);

  const angle = useSharedValue(angleOf(min));
  useEffect(() => {
    if (typeof value === 'number') angle.value = withTiming(angleOf(value), { duration: 180, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max]);
  const needle = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));

  const labelSize = Math.max(9, size * 0.065);
  const display = typeof value === 'number' ? value.toFixed(decimals) : value === null ? 'n/a' : '–';

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${label} ${display} ${unit}`}>
      <Svg width={size} height={size}>
        <Path d={arc(c, r, START, START + SWEEP)} stroke={colors.border} strokeWidth={size * 0.035} fill="none" strokeLinecap="round" />
        {redFrom != null && redFrom < max && (
          <Path d={arc(c, r, angleOf(redFrom), START + SWEEP)} stroke={STATUS_COLOR.defect} strokeWidth={size * 0.035} fill="none" />
        )}
        <G>
          {ticks.map(({ v, major }) => {
            const a = angleOf(v);
            const [x0, y0] = point(c, r - size * 0.03, a);
            const [x1, y1] = point(c, r - size * (major ? 0.1 : 0.065), a);
            const [tx, ty] = point(c, r - size * 0.17, a);
            const red = redFrom != null && v >= redFrom;
            return (
              <G key={v}>
                <Line x1={x0} y1={y0} x2={x1} y2={y1} stroke={red ? STATUS_COLOR.defect : muted} strokeWidth={major ? 2 : 1} />
                {major && (
                  <SvgText x={tx} y={ty + labelSize / 3} fill={red ? STATUS_COLOR.defect : fg} fontSize={labelSize} fontWeight="600" textAnchor="middle">
                    {+(v / divisor).toFixed(divisor > 1 ? 1 : 2)}
                  </SvgText>
                )}
              </G>
            );
          })}
        </G>
        {peak != null && peak > min && (
          <Circle cx={point(c, r, angleOf(peak))[0]} cy={point(c, r, angleOf(peak))[1]} r={size * 0.018} fill={colors.primary} />
        )}
        <Circle cx={c} cy={c} r={size * 0.045} fill={color ?? colors.primary} />
      </Svg>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, needle]}>
        <View
          style={[
            styles.needle,
            {
              left: c - size * 0.06,
              top: c - 1.5,
              width: r * 0.86 + size * 0.06,
              backgroundColor: color ?? colors.primary,
            },
          ]}
        />
      </Animated.View>
      <View pointerEvents="none" style={[styles.readout, { top: c + size * 0.14 }]}>
        <Text style={[styles.value, { fontSize: size * 0.16, color: fg }]} numberOfLines={1}>
          {display}
        </Text>
        <Text style={{ fontSize: Math.max(10, size * 0.06), color: muted }} numberOfLines={1}>
          {divisor > 1 ? `${unit} ×1000` : unit} · {label}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  needle: { position: 'absolute', height: 3, borderRadius: 2 },
  readout: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  value: { fontWeight: '800', fontVariant: ['tabular-nums'] },
});

/** Track the highest value seen while mounted; reset by changing `resetKey`. */
export function usePeak(value: number | null | undefined, resetKey?: unknown): number | null {
  const [peak, setPeak] = useState<number | null>(null);
  const [key, setKey] = useState(resetKey);
  // Adjust state during render (React's pattern for deriving from props), not in an effect.
  if (key !== resetKey) {
    setKey(resetKey);
    setPeak(null);
  } else if (typeof value === 'number' && (peak === null || value > peak)) {
    setPeak(value);
  }
  return peak;
}
