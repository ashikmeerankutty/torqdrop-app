import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { completeEmailLink, getPendingEmail } from '@/lib/auth/email-link';

/** Completes an email sign-in link routed here by `+native-intent`. */
export default function FinishSignInScreen() {
  const { colors } = useTheme();
  const { link } = useLocalSearchParams<{ link?: string }>();
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete(address: string) {
    if (!link) return setError('This sign-in link is incomplete.');
    setError(null);
    setBusy(true);
    try {
      // On success the session guard in the root layout leaves this screen.
      await completeEmailLink(address, link);
    } catch {
      setError('This link is invalid or has expired. Request a new one.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    getPendingEmail().then((pending) => (pending ? complete(pending) : setNeedsEmail(true)));
    // Runs once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  return (
    <Screen contentStyle={styles.content}>
      {needsEmail ? (
        <>
          <View style={styles.titleBlock}>
            <Text variant="title">Confirm your email</Text>
            <Text tone="textMuted">This link was requested on another device. Enter the email it was sent to.</Text>
          </View>
          <TextField
            large
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => complete(email.trim().toLowerCase())}
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
          />
          <Button title="Sign in" size="lg" loading={busy} onPress={() => complete(email.trim().toLowerCase())} />
        </>
      ) : (
        !error && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text tone="textMuted">Signing you in…</Text>
          </View>
        )
      )}
      {error && (
        <>
          <Banner tone="danger" title="Couldn't sign in">
            {error}
          </Banner>
          <Button title="Back to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  titleBlock: { gap: space.xs },
  center: { alignItems: 'center', gap: space.md },
});
