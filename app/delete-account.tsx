import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { deleteAccount } from '@/lib/firebase/account';
import { aiErrorMessage } from '@/lib/firebase/ai';
import { usePendingUploads } from '@/lib/firebase/upload-queue';
import { useInspections } from '@/lib/firebase/use-inspections';
import { useCredits } from '@/lib/firebase/billing';

const WHAT_GOES = [
  'Your name, email and sign-in',
  'Every inspection, with its answers, photos, AI findings and OBD readings',
  'Signed-off reports, and any links you shared (they stop working)',
  'Scanned RC and insurance details',
  'Your report balance and its history',
];

/** Permanent account deletion, as Google Play requires. Typing DELETE guards against accidents. */
export default function DeleteAccountScreen() {
  const inspections = useInspections();
  const pending = usePendingUploads();
  const credits = useCredits();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toUpperCase() === 'DELETE';

  async function run() {
    setBusy(true);
    setError(null);
    try {
      // On success the app restarts at the intro, so nothing after this runs.
      await deleteAccount();
    } catch (e) {
      setError(aiErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={<Button title="Delete my account" variant="danger" size="lg" disabled={!confirmed} loading={busy} onPress={run} />}>
      <Banner tone="danger" title="This can't be undone">
        {"Your account and everything in it are deleted permanently. We can't recover them."}
      </Banner>

      <Card>
        <Text variant="label" tone="textMuted">
          What gets deleted
        </Text>
        {WHAT_GOES.map((line) => (
          <View key={line} style={styles.row}>
            <Icon name="close" size={16} tone="danger" />
            <Text variant="caption" style={styles.grow}>
              {line}
            </Text>
          </View>
        ))}
        {inspections && inspections.length > 0 && (
          <Text variant="caption" tone="textMuted">
            That includes your {inspections.length} inspection{inspections.length === 1 ? '' : 's'}. Share any reports you need before
            deleting.
          </Text>
        )}
        {!!credits && credits.balance > 0 && (
          <Text variant="caption" tone="danger">
            {`Your ${credits.balance} unused report${credits.balance === 1 ? '' : 's'} will be lost and can't be refunded.`}
          </Text>
        )}
        {pending > 0 && (
          <Text variant="caption" tone="danger">
            {pending} photo{pending === 1 ? " hasn't" : "s haven't"} uploaded yet and will be deleted from this phone too.
          </Text>
        )}
      </Card>

      <TextField
        label="Type DELETE to confirm"
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
        placeholder="DELETE"
        error={error}
      />
      <Text variant="caption" tone="textSubtle">
        Deleting can take up to a minute. Keep the app open until it restarts.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
});
