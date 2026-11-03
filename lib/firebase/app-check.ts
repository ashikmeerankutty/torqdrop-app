import { getApp } from "@react-native-firebase/app";
import { initializeAppCheck, ReactNativeFirebaseAppCheckProvider } from "@react-native-firebase/app-check";

let started = false;

/**
 * App Check proves calls come from the real app. Release builds use Play Integrity / App Attest.
 * Dev builds use a debug token registered in the Firebase console and kept in the git-ignored .env.
 * Must run before the first callable function.
 */
export function startAppCheck() {
  if (started) return;
  started = true;
  const debugToken = process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN;
  const provider = new ReactNativeFirebaseAppCheckProvider();
  provider.configure({
    android: { provider: __DEV__ ? "debug" : "playIntegrity", debugToken },
    apple: { provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback", debugToken },
  });
  // A dev build made before App Check was added has no native module. Keep the app running;
  // only the AI calls fail, and they show their own message.
  try {
    initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
  } catch (e) {
    console.warn("App Check not started:", e);
  }
}
