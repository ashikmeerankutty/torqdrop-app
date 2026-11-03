import type { TextStyle } from 'react-native';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum touch target. Inspectors tap with gloves and one hand. */
export const TOUCH = 48;

export const typography = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16 },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  caption: { fontSize: 13 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  // Gauge readouts: fixed-width digits so values don't jitter as they update.
  metric: { fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
