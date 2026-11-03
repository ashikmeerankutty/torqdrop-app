import { StyleSheet, View } from 'react-native';

import { ProfileForm } from '@/components/ProfileForm';
import { Text } from '@/components/Themed';
import { Brand } from '@/components/ui/Brand';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';

/** First screen after a new sign-in: name and email. The root layout moves on once they're saved. */
export default function WelcomeScreen() {
  return (
    <Screen edgeToEdge>
      <Brand />
      <View style={styles.intro}>
        <Text variant="title">Welcome! Tell us about you</Text>
        <Text tone="textMuted">Just your name and email to finish setting up your account.</Text>
      </View>
      <ProfileForm submitLabel="Continue" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.sm, marginTop: space.md },
});
