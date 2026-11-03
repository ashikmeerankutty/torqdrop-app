/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */
import type { ComponentProps } from 'react';
import { Text as DefaultText, View as DefaultView } from 'react-native';

import { useColorScheme } from './useColorScheme';

import Colors from '@/constants/Colors';
import { typography, type TypographyVariant } from '@/constants/Theme';

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export type TextProps = ThemeProps &
  ComponentProps<typeof DefaultText> & {
    variant?: TypographyVariant;
    /** A theme colour name for the text, default `text`. */
    tone?: ThemeColor;
  };
export type ViewProps = ThemeProps & ComponentProps<typeof DefaultView>;

export function useThemeColor(props: { light?: string; dark?: string }, colorName: ThemeColor) {
  const theme = useColorScheme();
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

/** All colours for the current scheme. */
export function useTheme() {
  const scheme = useColorScheme();
  return { scheme, colors: Colors[scheme] };
}

export function Text(props: TextProps) {
  const { style, lightColor, darkColor, variant = 'body', tone = 'text', ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, tone);

  return <DefaultText style={[typography[variant], { color }, style]} {...otherProps} />;
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}
