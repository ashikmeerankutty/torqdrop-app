import { router } from 'expo-router';

import { ProfileForm } from '@/components/ProfileForm';
import { Screen } from '@/components/ui/Screen';

/** Edit name and email, from Account. */
export default function ProfileScreen() {
  return (
    <Screen>
      <ProfileForm submitLabel="Save" onSaved={() => router.back()} />
    </Screen>
  );
}
