import { memo, useEffect, useState } from 'react';
import Svg, { Polyline } from 'react-native-svg';

import { useTheme } from '@/components/Themed';
import { live, type LiveKey, type Sample } from '@/lib/obd/live';
import { isDerived, type MetricKey, readMetric } from '@/lib/obd/metrics';

/** Recent history of a metric. Derived metrics are sampled locally since they have no stored history. */
export function useMetricHistory(key: MetricKey, windowMs: number, refreshMs = 500): Sample[] {
  const [points, setPoints] = useState<Sample[]>([]);
  useEffect(() => {
    const derived: Sample[] = [];
    const tick = () => {
      if (isDerived(key)) {
        const v = readMetric(key);
        const now = Date.now();
        if (typeof v === 'number') derived.push({ t: now, v });
        while (derived.length && derived[0].t < now - windowMs) derived.shift();
        setPoints([...derived]);
      } else {
        setPoints(live.getHistory(key as LiveKey, windowMs));
      }
    };
    tick();
    const id = setInterval(tick, refreshMs);
    return () => clearInterval(id);
  }, [key, windowMs, refreshMs]);
  return points;
}

interface Props {
  points: Sample[];
  width: number;
  height: number;
  windowMs: number;
  min?: number;
  max?: number;
  color?: string;
}

export const Sparkline = memo(function Sparkline({ points, width, height, windowMs, min, max, color }: Props) {
  const { colors } = useTheme();
  if (points.length < 2 || width <= 0) return <Svg width={width} height={height} />;
  const vs = points.map((p) => p.v);
  const lo = min ?? Math.min(...vs);
  const hi = max ?? Math.max(...vs);
  const span = hi - lo || 1;
  const end = points[points.length - 1].t;
  const d = points
    .map((p) => {
      const x = width - ((end - p.t) / windowMs) * width;
      const y = height - 2 - ((p.v - lo) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={width} height={height}>
      <Polyline points={d} fill="none" stroke={color ?? colors.chart} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
});
