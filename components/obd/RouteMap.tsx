import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Text, useTheme } from '@/components/Themed';
import { space } from '@/constants/Theme';

export interface RoutePoint {
  lat: number;
  lon: number;
  value: number | null;
}

/** Sequential single-hue ramp, low = faint, high = strong, stepped per theme. */
const RAMP = {
  light: ['#c6dcf7', '#0b3f8c'],
  dark: ['#24415f', '#9fcbff'],
} as const;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function mix(a: string, b: string, f: number) {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * f)).join(',')})`;
}

interface Props {
  points: RoutePoint[];
  width: number;
  height?: number;
  label: string;
  unit: string;
  decimals: number;
}

/**
 * The trip's GPS track drawn on its own, coloured by a reading (speed, rpm, economy). No base map:
 * it shows the shape of the drive and where the values changed without a maps API key.
 */
export const RouteMap = memo(function RouteMap({ points, width, height = 260, label, unit, decimals }: Props) {
  const { scheme, colors } = useTheme();
  const [lo, hi] = RAMP[scheme === 'dark' ? 'dark' : 'light'];
  if (points.length < 2) return null;

  // Equirectangular projection around the trip's middle latitude.
  const midLat = (Math.min(...points.map((p) => p.lat)) + Math.max(...points.map((p) => p.lat))) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = points.map((p) => p.lon * k);
  const ys = points.map((p) => p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 12;
  const scale = Math.min((width - pad * 2) / (x1 - x0 || 1e-6), (height - pad * 2) / (y1 - y0 || 1e-6));
  const ox = (width - (x1 - x0) * scale) / 2;
  const oy = (height - (y1 - y0) * scale) / 2;
  const px = (i: number) => ox + (xs[i] - x0) * scale;
  const py = (i: number) => height - (oy + (ys[i] - y0) * scale);

  const vals = points.map((p) => p.value).filter((v): v is number => typeof v === 'number');
  const [vmin, vmax] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  const color = (v: number | null) => (v == null ? colors.textSubtle : mix(lo, hi, (v - vmin) / (vmax - vmin || 1)));

  // At most ~600 segments keeps rendering quick on long trips.
  const step = Math.max(1, Math.floor(points.length / 600));
  const segs: number[] = [];
  for (let i = step; i < points.length; i += step) segs.push(i);

  return (
    <View style={styles.wrap}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} rx={12} fill={colors.surfaceRaised} />
        {segs.map((i) => (
          <Line key={i} x1={px(i - step)} y1={py(i - step)} x2={px(i)} y2={py(i)} stroke={color(points[i].value)} strokeWidth={4} strokeLinecap="round" />
        ))}
        <Circle cx={px(0)} cy={py(0)} r={6} fill={colors.surface} stroke={colors.text} strokeWidth={2} />
        <Circle cx={px(points.length - 1)} cy={py(points.length - 1)} r={6} fill={colors.text} />
      </Svg>
      <View style={styles.legend}>
        <Text variant="caption" tone="textMuted">
          {vmin.toFixed(decimals)}
        </Text>
        <Svg width={120} height={10}>
          <Defs>
            <LinearGradient id="ramp" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={lo} />
              <Stop offset="1" stopColor={hi} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={120} height={10} rx={5} fill="url(#ramp)" />
        </Svg>
        <Text variant="caption" tone="textMuted">
          {vmax.toFixed(decimals)} {unit}
        </Text>
        <Text variant="caption" tone="textMuted" style={styles.grow}>
          {label} · ○ start ● end
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  grow: { flex: 1, textAlign: 'right' },
});
