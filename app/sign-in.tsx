import { type ConfirmationResult, getAuth, signInWithPhoneNumber } from '@react-native-firebase/auth';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Brand } from '@/components/ui/Brand';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { radius, space } from '@/constants/Theme';
import { sendEmailLink } from '@/lib/auth/email-link';
import { toE164India } from '@/lib/auth/links';
import { PRIVACY_URL } from '@/lib/links';

type Step =
  | { kind: 'phone' }
  | { kind: 'code'; phone: string; confirmation: ConfirmationResult }
  | { kind: 'email' }
  | { kind: 'emailSent'; email: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER_S = 30;

export default function SignInScreen() {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>({ kind: 'phone' });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function goTo(next: Step) {
    setStep(next);
    setValue('');
    setError(null);
  }

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // Firebase errors carry a `code` like auth/too-many-requests; show it in dev builds to diagnose setup issues.
      const code = (e as { code?: string }).code;
      console.warn('[sign-in]', code, e);
      setError(__DEV__ && code ? `${failure} (${code})` : failure);
    } finally {
      setBusy(false);
    }
  }

  function sendCode(phone: string) {
    return run(async () => {
      const confirmation = await signInWithPhoneNumber(getAuth(), phone);
      goTo({ kind: 'code', phone, confirmation });
      setResendIn(RESEND_AFTER_S);
    }, 'Could not send the code. Check the number and try again.');
  }

  function submit() {
    switch (step.kind) {
      case 'phone': {
        const phone = toE164India(value);
        if (!phone) return setError('Enter a 10-digit Indian mobile number.');
        return sendCode(phone);
      }
      case 'code':
        if (!/^\d{6}$/.test(value)) return setError('Enter the 6-digit code.');
        // On success the session guard in the root layout leaves this screen.
        return run(async () => {
          await step.confirmation.confirm(value);
        }, 'That code is wrong or has expired.');
      case 'email': {
        const email = value.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(email)) return setError('Enter a valid email address.');
        return run(async () => {
          await sendEmailLink(email);
          goTo({ kind: 'emailSent', email });
        }, 'Could not send the sign-in link. Try again.');
      }
    }
  }

  if (step.kind === 'emailSent') {
    return (
      <Screen edgeToEdge contentStyle={styles.content}>
        <Brand large />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.iconBadge, { backgroundColor: colors.primarySoft }]}>
            <Icon name="mail" size={28} tone="primary" />
          </View>
          <Text variant="title">Check your email</Text>
          <Text tone="textMuted">
            We sent a sign-in link to <Text variant="bodyStrong">{step.email}</Text>. Open it on this phone to continue.
          </Text>
          <Button title="Use phone number instead" variant="ghost" onPress={() => goTo({ kind: 'phone' })} />
        </View>
      </Screen>
    );
  }

  const copy = {
    phone: { title: 'Sign in', hint: "We'll text you a 6-digit code.", action: 'Send code' },
    code: {
      title: 'Enter the code',
      hint: `Sent by SMS to ${step.kind === 'code' ? step.phone.replace(/^\+91/, '+91 ') : ''}`,
      action: 'Verify and continue',
    },
    email: { title: 'Sign in with email', hint: "We'll email you a one-time sign-in link.", action: 'Send link' },
  }[step.kind];

  return (
    <Screen edgeToEdge contentStyle={styles.content}>
      <View style={styles.hero}>
        <Brand large />
        <Text tone="textMuted" variant="body">
          Inspect cars with confidence. Live diagnostics, photo evidence and AI help, in one app.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.titleBlock}>
          <Text variant="title">{copy.title}</Text>
          <Text tone="textMuted">{copy.hint}</Text>
        </View>

        {step.kind === 'code' ? (
          <TextField
            key="code"
            large
            value={value}
            onChangeText={(v) => setValue(v.replace(/\D/g, '').slice(0, 6))}
            onSubmitEditing={submit}
            editable={!busy}
            autoFocus
            placeholder="••••••"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            keyboardType="number-pad"
            maxLength={6}
            style={styles.code}
            error={error}
          />
        ) : (
          <TextField
            key={step.kind}
            large
            prefix={step.kind === 'phone' ? '+91' : undefined}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            editable={!busy}
            autoFocus
            autoCapitalize="none"
            placeholder={step.kind === 'phone' ? '98765 43210' : 'you@example.com'}
            autoComplete={step.kind === 'phone' ? 'tel' : 'email'}
            keyboardType={step.kind === 'phone' ? 'phone-pad' : 'email-address'}
            textContentType={step.kind === 'phone' ? 'telephoneNumber' : 'emailAddress'}
            error={error}
          />
        )}

        <Button title={copy.action} size="lg" loading={busy} onPress={submit} />

        {step.kind === 'code' && (
          <View style={styles.codeActions}>
            <Button title="Change number" variant="ghost" onPress={() => goTo({ kind: 'phone' })} disabled={busy} />
            <Button
              title={resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              variant="ghost"
              disabled={busy || resendIn > 0}
              onPress={() => sendCode(step.phone)}
            />
          </View>
        )}
      </View>

      <View style={styles.alt}>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />
        <Text variant="caption" tone="textSubtle">
          {step.kind === 'email' ? 'or' : "Didn't get a code?"}
        </Text>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />
      </View>
      <Button
        title={step.kind === 'email' ? 'Use phone number' : 'Sign in with email instead'}
        icon={step.kind === 'email' ? 'sms' : 'mail'}
        variant="secondary"
        disabled={busy}
        onPress={() => goTo(step.kind === 'email' ? { kind: 'phone' } : { kind: 'email' })}
      />
      <Text variant="caption" tone="textSubtle" style={styles.legal}>
        By continuing you agree to how we handle your data in our{' '}
        <Text variant="caption" tone="tint" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} accessibilityRole="link">
          privacy policy
        </Text>
        .
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl, flexGrow: 1, justifyContent: 'center' },
  hero: { gap: space.md },
  card: { borderWidth: 1, borderRadius: radius.xl, padding: space.xl, gap: space.lg },
  titleBlock: { gap: space.xs },
  iconBadge: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  code: { letterSpacing: 12, textAlign: 'center', fontSize: 26 },
  codeActions: { flexDirection: 'row', justifyContent: 'space-between' },
  alt: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  legal: { textAlign: 'center' },
});
