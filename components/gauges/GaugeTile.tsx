import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { radius, space } from '@/constants/Theme';
import { getCarSettings } from '@/lib/car-settings';
import type { GaugeStyle } from '@/lib/obd/dashboards';
import { usePidDemand } from '@/lib/obd/live';
import { metricDef, type MetricKey, redlineRpm, useMetric, useMetricsVehicle } from '@/lib/obd/metrics';

import { AnalogGauge, usePeak } from './AnalogGauge';
import { Sparkline, useMetricHistory } from './Sparkline';

/** How often each style polls its readings. Dials and bars want to move smoothly. */
export const STYLE_INTERVAL: Record<GaugeStyle, number> = { dial: 100, bar: 150, spark: 500, number: 1000 };

/** Colour for a reading outside its normal range; undefined when normal. */
export function warnColor(key: MetricKey, v: number, redline: number): string | undefined {
  const coolantLimit = getCarSettings().alerts.coolantC;
  if (key === 'coolantTemp') return v >= coolantLimit + 7 ? STATUS_COLOR.defect : v >= coolantLimit ? STATUS_COLOR.attention : undefined;
  if (key === 'moduleVoltage' || key === 'batteryVoltage') return v < 12 ? STATUS_COLOR.attention : undefined;
  if (key === 'shortFuelTrim1' || key === 'longFuelTrim1' || key === 'shortFuelTrim2' || key === 'longFuelTrim2')
    return Math.abs(v) > 10 ? STATUS_COLOR.attention : undefined;
  if (key === 'rpm') return v >= redline ? STATUS_COLOR.defect : undefined;
  if (key === 'fuelLevel') return v < 12 ? STATUS_COLOR.attention : undefined;
  if (key === 'oilTemp') return v > 130 ? STATUS_COLOR.attention : undefined;
  return undefined;
}

export function formatMetric(key: MetricKey, v: number | null | undefined): string {
  if (v === undefined) return '–';
  if (v === null) return 'n/a';
  if (key === 'gear') return v === 0 ? 'N' : String(v);
  return v.toFixed(metricDef(key).decimals);
}

interface Props {
  metric: MetricKey;
  style: GaugeStyle;
  /** Tile width in points. */
  width: number;
  /** Stop polling while the screen is hidden. */
  active: boolean;
  onLongPress?: () => void;
}

export const GaugeTile = memo(function GaugeTile({ metric, style, width, active, onLongPress }: Props) {
  const { colors } = useTheme();
  const def = metricDef(metric);
  usePidDemand(def.sources, STYLE_INTERVAL[style], active);
  const value = useMetric(metric);
  const vehicle = useMetricsVehicle();
  const redline = redlineRpm(vehicle);
  const warn = typeof value === 'number' ? warnColor(metric, value, redline) : undefined;
  const [resetKey, setResetKey] = useState(0);
  const peak = usePeak(style === 'dial' ? value : null, resetKey);
  const inner = width - space.md * 2;
  const unavailable = value === null;
  const max = metric === 'rpm' ? Math.max(def.max, Math.ceil((redline + 1000) / 1000) * 1000) : def.max;

  return (
    <Pressable
      onLongPress={onLongPress}
      onPress={style === 'dial' ? () => setResetKey((k) => k + 1) : undefined}
      accessibilityHint={style === 'dial' ? 'Tap to reset the peak marker' : undefined}
      style={[styles.tile, { width, backgroundColor: colors.surface, borderColor: warn ?? colors.border }, warn && { borderWidth: 1.5 }]}>
      {style !== 'dial' && (
        <Text variant="caption" tone="textMuted" numberOfLines={1}>
          {def.short}
          {def.estimate ? ' (est.)' : ''}
        </Text>
      )}
      {unavailable ? (
        <Text variant="caption" tone="textSubtle" style={styles.na}>
          {def.estimate ? 'Not enough data from this car' : 'Not supported by this car'}
        </Text>
      ) : style === 'dial' ? (
        <View style={styles.center}>
          <AnalogGauge
            value={value}
            min={def.min}
            max={max}
            size={Math.min(inner, 320)}
            label={def.short}
            unit={def.unit}
            decimals={def.decimals}
            redFrom={metric === 'rpm' ? redline : undefined}
            peak={peak}
          />
        </View>
      ) : style === 'bar' ? (
        <BarReadout metric={metric} value={value} warn={warn} />
      ) : style === 'spark' ? (
        <SparkReadout metric={metric} value={value} warn={warn} width={inner} />
      ) : (
        <Text variant="metric" style={warn ? { color: warn } : undefined} numberOfLines={1} adjustsFontSizeToFit>
          {formatMetric(metric, value)}
          <Text variant="caption" tone="textMuted">
            {' '}
            {def.unit}
          </Text>
        </Text>
      )}
    </Pressable>
  );
});

function BarReadout({ metric, value, warn }: { metric: MetricKey; value: number | undefined; warn?: string }) {
  const { colors } = useTheme();
  const def = metricDef(metric);
  const frac = typeof value === 'number' ? Math.max(0, Math.min(1, (value - def.min) / (def.max - def.min))) : 0;
  return (
    <View style={styles.barWrap}>
      <Text variant="metric" style={[styles.barValue, warn ? { color: warn } : undefined]}>
        {formatMetric(metric, value)}
        <Text variant="caption" tone="textMuted">
          {' '}
          {def.unit}
        </Text>
      </Text>
      <View style={[styles.track, { backgroundColor: colors.surfaceRaised }]}>
        <Animated.View
          style={[styles.fill, { backgroundColor: warn ?? colors.primary, width: `${frac * 100}%`, transitionProperty: 'width', transitionDuration: 150 }]}
        />
      </View>
    </View>
  );
}

const SPARK_WINDOW = 60_000;

function SparkReadout({ metric, value, warn, width }: { metric: MetricKey; value: number | undefined; warn?: string; width: number }) {
  const def = metricDef(metric);
  const points = useMetricHistory(metric, SPARK_WINDOW);
  return (
    <View>
      <Text variant="metric" style={[styles.barValue, warn ? { color: warn } : undefined]}>
        {formatMetric(metric, value)}
        <Text variant="caption" tone="textMuted">
          {' '}
          {def.unit}
        </Text>
      </Text>
      <Sparkline points={points} width={width} height={36} windowMs={SPARK_WINDOW} color={warn} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 2 },
  center: { alignItems: 'center' },
  na: { paddingVertical: 10 },
  barWrap: { gap: space.xs },
  barValue: { fontSize: 24 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
