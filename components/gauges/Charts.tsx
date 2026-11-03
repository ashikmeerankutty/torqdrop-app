import { memo, useState } from 'react';
import { type GestureResponderEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { Text, useTheme } from '@/components/Themed';
import { space } from '@/constants/Theme';
import type { Sample } from '@/lib/obd/live';

const PAD = { left: 40, right: 8, top: 8, bottom: 20 };

function extent(vs: number[], min?: number, max?: number): [number, number] {
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (min !== undefined) lo = Math.min(lo, min);
  if (max !== undefined) hi = Math.max(hi, max);
  if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
  return [lo, hi];
}

const fmt = (v: number, decimals: number) => v.toFixed(decimals);

interface TimeProps {
  title: string;
  unit: string;
  decimals: number;
  points: Sample[];
  width: number;
  height?: number;
  windowMs: number;
  /** Fixed lower/upper bounds to include, e.g. 0 for speed. */
  min?: number;
  max?: number;
  /** Time axis is relative to now (live) or to the first point (recorded trips). */
  relative?: 'now' | 'start';
}

/**
 * One reading over time. Several readings are shown as stacked charts sharing the time axis
 * (never two scales on one chart). Touch and drag to read exact values.
 */
export const TimeChart = memo(function TimeChart({ title, unit, decimals, points, width, height = 140, windowMs, min, max, relative = 'now' }: TimeProps) {
  const { colors } = useTheme();
  const [touchX, setTouchX] = useState<number | null>(null);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const has = points.length >= 2;
  const [lo, hi] = has ? extent(points.map((p) => p.v), min, max) : [0, 1];
  const end = relative === 'now' ? (has ? Math.max(points[points.length - 1].t, Date.now() - 500) : Date.now()) : (points[0]?.t ?? 0) + windowMs;
  const start = end - windowMs;
  const x = (t: number) => PAD.left + ((t - start) / windowMs) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  let hover: Sample | null = null;
  if (touchX != null && has) {
    const t = start + ((touchX - PAD.left) / plotW) * windowMs;
    hover = points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  }
  const onTouch = (e: GestureResponderEvent) => setTouchX(Math.max(PAD.left, Math.min(width - PAD.right, e.nativeEvent.locationX)));
  const timeLabel = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
  };
  const last = points[points.length - 1];

  return (
    <View style={styles.chart}>
      <View style={styles.titleRow}>
        <Text variant="bodyStrong" style={styles.grow} numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone="textMuted">
          {hover ? `${fmt(hover.v, decimals)} ${unit} · ${timeLabel(relative === 'now' ? end - hover.t : hover.t - (points[0]?.t ?? 0))}${relative === 'now' ? ' ago' : ''}` : last ? `${fmt(last.v, decimals)} ${unit}` : 'No data yet'}
        </Text>
      </View>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch}
        onResponderMove={onTouch}
        onResponderRelease={() => setTouchX(null)}
        onResponderTerminate={() => setTouchX(null)}
        accessibilityLabel={`${title} chart`}>
        <Svg width={width} height={height}>
          {[0, 0.5, 1].map((f) => {
            const v = lo + f * (hi - lo);
            return (
              <Line key={f} x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={1} />
            );
          })}
          {[0, 1].map((f) => {
            const v = lo + f * (hi - lo);
            return (
              <SvgText key={f} x={PAD.left - 6} y={y(v) + 4} fill={colors.textMuted} fontSize={10} textAnchor="end">
                {fmt(v, decimals)}
              </SvgText>
            );
          })}
          <SvgText x={PAD.left} y={height - 4} fill={colors.textMuted} fontSize={10}>
            {relative === 'now' ? `−${timeLabel(windowMs)}` : '0'}
          </SvgText>
          <SvgText x={width - PAD.right} y={height - 4} fill={colors.textMuted} fontSize={10} textAnchor="end">
            {relative === 'now' ? 'now' : timeLabel(windowMs)}
          </SvgText>
          {has && (
            <Polyline
              points={points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={colors.chart}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          )}
          {hover && (
            <>
              <Line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.top} y2={PAD.top + plotH} stroke={colors.textMuted} strokeWidth={1} />
              <Circle cx={x(hover.t)} cy={y(hover.v)} r={5} fill={colors.chart} stroke={colors.surface} strokeWidth={2} />
            </>
          )}
        </Svg>
      </View>
    </View>
  );
});

interface ScatterProps {
  xLabel: string;
  yLabel: string;
  xDecimals: number;
  yDecimals: number;
  pairs: { x: number; y: number }[];
  width: number;
  height?: number;
}

/** One reading against another, e.g. boost against rpm. */
export const ScatterChart = memo(function ScatterChart({ xLabel, yLabel, xDecimals, yDecimals, pairs, width, height = 260 }: ScatterProps) {
  const { colors } = useTheme();
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom - 4;
  const has = pairs.length > 0;
  const [xl, xh] = has ? extent(pairs.map((p) => p.x)) : [0, 1];
  const [yl, yh] = has ? extent(pairs.map((p) => p.y)) : [0, 1];
  const sx = (v: number) => PAD.left + ((v - xl) / (xh - xl)) * plotW;
  const sy = (v: number) => PAD.top + plotH - ((v - yl) / (yh - yl)) * plotH;
  return (
    <View style={styles.chart}>
      <Text variant="caption" tone="textMuted">
        {yLabel} (up) against {xLabel} (across) · {pairs.length} points
      </Text>
      <Svg width={width} height={height}>
        <Line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke={colors.border} />
        <Line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + plotH} stroke={colors.border} />
        <SvgText x={PAD.left - 6} y={PAD.top + 8} fill={colors.textMuted} fontSize={10} textAnchor="end">
          {fmt(yh, yDecimals)}
        </SvgText>
        <SvgText x={PAD.left - 6} y={PAD.top + plotH} fill={colors.textMuted} fontSize={10} textAnchor="end">
          {fmt(yl, yDecimals)}
        </SvgText>
        <SvgText x={PAD.left} y={height - 4} fill={colors.textMuted} fontSize={10}>
          {fmt(xl, xDecimals)}
        </SvgText>
        <SvgText x={width - PAD.right} y={height - 4} fill={colors.textMuted} fontSize={10} textAnchor="end">
          {fmt(xh, xDecimals)}
        </SvgText>
        {pairs.map((p, i) => (
          <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={colors.chart} fillOpacity={0.45} />
        ))}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  chart: { gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
});
