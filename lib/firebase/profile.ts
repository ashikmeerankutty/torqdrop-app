import { getAuth, updateProfile } from "@react-native-firebase/auth";
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from "@react-native-firebase/firestore";

/** Stored at `users/{uid}`. Written by the owner only (Security Rules). */
export interface UserProfile {
  fullName: string;
  email: string;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The profile, or null if the user hasn't filled it in yet. */
export function subscribeProfile(uid: string, onChange: (profile: UserProfile | null) => void) {
  return onSnapshot(
    doc(getFirestore(), "users", uid),
    (snap) => {
      const data = snap.data();
      onChange(data?.fullName && data?.email ? { fullName: data.fullName, email: data.email } : null);
    },
    (e) => {
      console.warn("[profile] read failed", e);
      onChange(null);
    },
  );
}

/**
 * Saves the name and email, and puts the name on the Firebase account too. Resolves once the local
 * write is applied, so the app can move on offline; the server write follows when online.
 */
export async function saveProfile(uid: string, profile: UserProfile) {
  const fullName = profile.fullName.trim().replace(/\s+/g, " ");
  const email = profile.email.trim().toLowerCase();
  const write = setDoc(
    doc(getFirestore(), "users", uid),
    { fullName, email, updatedAt: serverTimestamp() },
    { merge: true },
  );
  write.catch((e) => console.warn("[profile] save failed", e));
  const user = getAuth().currentUser;
  if (user && user.displayName !== fullName) updateProfile(user, { displayName: fullName }).catch(() => {});
}
