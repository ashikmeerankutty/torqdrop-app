import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useThemeColor, type ThemeColor } from '@/components/Themed';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/** One name per icon used in the app, mapped to SF Symbols (iOS) and Material Symbols (Android). */
const ICONS = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  inspections: { ios: 'checklist', android: 'fact_check', web: 'fact_check' },
  drive: { ios: 'gauge.with.needle', android: 'speed', web: 'speed' },
  account: { ios: 'person.crop.circle', android: 'person', web: 'person' },
  car: { ios: 'car.fill', android: 'directions_car', web: 'directions_car' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' },
  forward: { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  bluetooth: { ios: 'antenna.radiowaves.left.and.right', android: 'bluetooth', web: 'bluetooth' },
  scanning: { ios: 'dot.radiowaves.left.and.right', android: 'bluetooth_searching', web: 'bluetooth_searching' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
  error: { ios: 'exclamationmark.octagon.fill', android: 'error', web: 'error' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  camera: { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' },
  ai: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  upload: { ios: 'icloud.and.arrow.up', android: 'cloud_upload', web: 'cloud_upload' },
  uploaded: { ios: 'checkmark.icloud', android: 'cloud_done', web: 'cloud_done' },
  dark: { ios: 'moon.fill', android: 'dark_mode', web: 'dark_mode' },
  light: { ios: 'sun.max.fill', android: 'light_mode', web: 'light_mode' },
  system: { ios: 'circle.lefthalf.filled', android: 'contrast', web: 'contrast' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  shield: { ios: 'checkmark.shield.fill', android: 'verified', web: 'verified' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  mail: { ios: 'envelope.fill', android: 'mail', web: 'mail' },
  sms: { ios: 'message.fill', android: 'sms', web: 'sms' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  receipt: { ios: 'creditcard.fill', android: 'receipt_long', web: 'receipt_long' },
  signal: { ios: 'cellularbars', android: 'signal_cellular_alt', web: 'signal_cellular_alt' },
  engineer: { ios: 'wrench.and.screwdriver.fill', android: 'engineering', web: 'engineering' },
  thermometer: { ios: 'thermometer.medium', android: 'thermostat', web: 'thermostat' },
  battery: { ios: 'minus.plus.batteryblock.fill', android: 'battery_charging_full', web: 'battery_charging_full' },
  // Car features
  garage: { ios: 'car.2.fill', android: 'garage', web: 'garage' },
  route: { ios: 'point.topleft.down.to.point.bottomright.curvepath', android: 'route', web: 'route' },
  timer: { ios: 'stopwatch.fill', android: 'timer', web: 'timer' },
  chart: { ios: 'chart.xyaxis.line', android: 'show_chart', web: 'show_chart' },
  list: { ios: 'list.bullet', android: 'list', web: 'list' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  tune: { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' },
  fullscreen: { ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen', web: 'fullscreen' },
  fuel: { ios: 'fuelpump.fill', android: 'local_gas_station', web: 'local_gas_station' },
  wrench: { ios: 'wrench.fill', android: 'build', web: 'build' },
  delete: { ios: 'trash', android: 'delete', web: 'delete' },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'share' },
  mic: { ios: 'mic.fill', android: 'mic', web: 'mic' },
  hearing: { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' },
  videocam: { ios: 'video.fill', android: 'videocam', web: 'videocam' },
  record: { ios: 'record.circle', android: 'fiber_manual_record', web: 'fiber_manual_record' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  health: { ios: 'heart.text.square.fill', android: 'monitor_heart', web: 'monitor_heart' },
  location: { ios: 'location.fill', android: 'location_on', web: 'location_on' },
  mirror: { ios: 'arrow.left.and.right.righttriangle.left.righttriangle.right', android: 'flip', web: 'flip' },
  up: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  down: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
  // Inspection sections
  documents: { ios: 'doc.text.fill', android: 'description', web: 'description' },
  engine: { ios: 'engine.combustion.fill', android: 'car_repair', web: 'car_repair' },
  transmission: { ios: 'gearshape.2.fill', android: 'settings', web: 'settings' },
  suspension: { ios: 'arrow.up.and.down', android: 'swap_vert', web: 'swap_vert' },
  steering: { ios: 'steeringwheel', android: 'tune', web: 'tune' },
  brakes: { ios: 'exclamationmark.brakesignal', android: 'no_crash', web: 'no_crash' },
  electricals: { ios: 'bolt.fill', android: 'electric_bolt', web: 'electric_bolt' },
  body: { ios: 'car.side.fill', android: 'minor_crash', web: 'minor_crash' },
  structure: { ios: 'car.side.rear.open.fill', android: 'car_crash', web: 'car_crash' },
  glass: { ios: 'window.vertical.closed', android: 'window', web: 'window' },
  tyres: { ios: 'circle.circle', android: 'tire_repair', web: 'tire_repair' },
  interior: { ios: 'carseat.left.fill', android: 'airline_seat_recline_normal', web: 'airline_seat_recline_normal' },
  flood: { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' },
} satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
  /** A theme colour name, or pass `color` for a fixed colour. */
  tone?: ThemeColor;
  color?: ColorValue;
}

export function Icon({ name, size = 22, tone = 'text', color }: Props) {
  const themed = useThemeColor({}, tone);
  return <SymbolView name={ICONS[name]} tintColor={color ?? themed} size={size} />;
}
