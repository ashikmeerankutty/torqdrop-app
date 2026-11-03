import { useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { useSession } from '@/lib/auth/session';
import { EMAIL_PATTERN, saveProfile } from '@/lib/firebase/profile';

/**
 * Full name and email. For email sign-ins the email is the verified sign-in address and can't be
 * changed here; phone sign-ins type it in.
 */
export function ProfileForm({ submitLabel, onSaved }: { submitLabel: string; onSaved?: () => void }) {
  const { user, profile } = useSession();
  const signInEmail = user?.email ?? null;
  const [fullName, setFullName] = useState(profile?.fullName ?? user?.displayName ?? '');
  const [email, setEmail] = useState(signInEmail ?? profile?.email ?? '');
  const [errors, setErrors] = useState<{ fullName?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const name = fullName.trim().replace(/\s+/g, ' ');
    const mail = email.trim().toLowerCase();
    const next: typeof errors = {};
    if (name.length < 2) next.fullName = 'Enter your full name.';
    else if (name.length > 80) next.fullName = 'Keep it under 80 characters.';
    if (!EMAIL_PATTERN.test(mail)) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length || !user) return;
    setSaving(true);
    try {
      await saveProfile(user.uid, { fullName: name, email: mail });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: space.lg }}>
      <TextField
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        placeholder="As you'd sign a report"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        error={errors.fullName}
        autoFocus={!fullName}
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!signInEmail}
        hint={signInEmail ? 'Your sign-in email.' : "We'll send reports and receipts here."}
        error={errors.email}
      />
      <Button title={submitLabel} size="lg" loading={saving} onPress={save} />
      <Text variant="caption" tone="textSubtle">
        {"Your name appears on reports you sign off. We don't share your details."}
      </Text>
    </View>
  );
}
