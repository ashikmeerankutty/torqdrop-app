import { getAuth, sendSignInLinkToEmail, signInWithEmailLink } from "@react-native-firebase/auth";
import * as SecureStore from "expo-secure-store";

const PENDING_EMAIL_KEY = "auth.pendingEmail";
const APP_ID = "com.torqdrop.connect";

/** Must be on an Authorized domain. The default Hosting domain also serves the App/Universal Link files. */
const CONTINUE_URL = "https://torqdrop-connect.firebaseapp.com/finish-sign-in";

/** Email-link sign-in is the fallback when SMS OTP doesn't arrive. The email is kept on device, never in the URL. */
export async function sendEmailLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(getAuth(), email, {
    url: CONTINUE_URL,
    handleCodeInApp: true,
    iOS: { bundleId: APP_ID },
    android: { packageName: APP_ID, installApp: true, minimumVersion: "1" },
  });
  await SecureStore.setItemAsync(PENDING_EMAIL_KEY, email);
}

/** Email the link was sent to from this device, or null if it was opened elsewhere. */
export function getPendingEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(PENDING_EMAIL_KEY);
}

export async function completeEmailLink(email: string, link: string): Promise<void> {
  await signInWithEmailLink(getAuth(), email, link);
  await SecureStore.deleteItemAsync(PENDING_EMAIL_KEY);
}
