import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { signOutUser, useSession } from '@/lib/auth/session';
import { reportsLeft } from '@/lib/billing/plans';
import { useCredits } from '@/lib/firebase/billing';
import { usePendingUploads } from '@/lib/firebase/upload-queue';
import { PRIVACY_URL } from '@/lib/links';
import { setMode, setTheme, type ThemePreference, type UsageMode, usePreferences } from '@/lib/preferences';

const MODES: { value: UsageMode; label: string; icon: IconName }[] = [
  { value: 'inspector', label: 'Inspector', icon: 'engineer' },
  { value: 'owner', label: 'Car owner', icon: 'car' },
];

const THEMES: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'dark', label: 'Dark', icon: 'dark' },
  { value: 'light', label: 'Light', icon: 'light' },
  { value: 'system', label: 'System', icon: 'system' },
];

export default function AccountScreen() {
  const { colors } = useTheme();
  const { user, profile } = useSession();
  const pending = usePendingUploads();
  const credits = useCredits();
  const left = credits ? reportsLeft(credits) : null;
  const prefs = usePreferences();
  const id = user?.phoneNumber ?? user?.email ?? '';

  function confirmSignOut() {
    const warning = pending
      ? `${pending} photo${pending === 1 ? ' has' : 's have'} not uploaded yet and will stay on this phone until you sign back in.`
      : 'You can sign back in any time.';
    Alert.alert('Sign out?', warning, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOutUser() },
    ]);
  }

  return (
    <Screen>
      <Card onPress={() => router.push('/profile')} accessibilityLabel="Edit your details">
        <View style={styles.profile}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text variant="heading" style={{ color: colors.onPrimary }}>
              {initials(profile?.fullName)}
            </Text>
          </View>
          <View style={styles.grow}>
            <Text variant="heading" numberOfLines={1}>
              {profile?.fullName ?? 'Add your name'}
            </Text>
            {profile?.email && (
              <Text variant="caption" tone="textMuted" numberOfLines={1}>
                {profile.email}
              </Text>
            )}
            <Text variant="caption" tone="textSubtle" numberOfLines={1}>
              Signed in with {user?.phoneNumber ? 'phone' : 'email'}: {id}
            </Text>
          </View>
          <Icon name="chevron" size={20} tone="textSubtle" />
        </View>
      </Card>

      {pending > 0 && (
        <Banner tone="warning" icon="upload" title={`${pending} photo${pending === 1 ? '' : 's'} not uploaded yet`}>
          {"They stay on this phone and upload automatically when you're online."}
        </Banner>
      )}

      <Segmented label="I use TorqDrop as" options={MODES} value={prefs.mode} onChange={setMode} />
      <Segmented label="Appearance" options={THEMES} value={prefs.theme} onChange={setTheme} />

      <Card onPress={() => router.push('/plans')} accessibilityLabel="Reports and billing">
        <View style={styles.profile}>
          <Icon name="receipt" size={22} tone="primary" />
          <View style={styles.grow}>
            <Text variant="bodyStrong">Reports and billing</Text>
            <Text variant="caption" tone="textMuted">
              {left === null ? 'Report packs' : `${left} report${left === 1 ? '' : 's'} left · buy report packs`}
            </Text>
          </View>
          <Icon name="chevron" size={20} tone="textSubtle" />
        </View>
      </Card>

      <Card>
        <View style={styles.aboutRow}>
          <Icon name="shield" size={20} tone="textMuted" />
          <Text variant="caption" tone="textMuted" style={styles.grow}>
            TorqDrop is an inspection assistant, not a mechanical guarantee. AI suggestions are always marked and need
            an inspector to confirm them.
          </Text>
        </View>
      </Card>

      <Button title="Privacy policy" icon="shield" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} />
      <Button title="Sign out" icon="logout" variant="danger" onPress={confirmSignOut} />
      <Button title="Delete account" variant="ghost" onPress={() => router.push('/delete-account')} />
      <Text variant="caption" tone="textSubtle" style={styles.center}>
        TorqDrop {Constants.expoConfig?.version ?? ''}
      </Text>
    </Screen>
  );
}

function initials(name: string | undefined) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; icon: IconName }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <Text variant="label" tone="textMuted">
        {label}
      </Text>
      <View style={[styles.segmented, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.segment, selected && { backgroundColor: colors.primary }]}>
              <Icon name={o.icon} size={18} color={selected ? colors.onPrimary : colors.textMuted} />
              <Text variant="caption" style={[styles.segmentText, { color: selected ? colors.onPrimary : colors.text }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  group: { gap: space.sm },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: radius.sm,
  },
  segmentText: { fontWeight: '700', fontSize: 14 },
  aboutRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  center: { textAlign: 'center' },
});
