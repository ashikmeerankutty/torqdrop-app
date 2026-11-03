import { getAuth, signOut } from "@react-native-firebase/auth";
import { clearPersistence, getFirestore, terminate } from "@react-native-firebase/firestore";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import { reloadAppAsync } from "expo";

import { clearPersonalPreferences } from "@/lib/preferences";

import { clearUploadQueue } from "./upload-queue";

/**
 * Permanently deletes the account and all its data on the server, then wipes what this phone holds:
 * queued photos, the offline database cache and personal preferences. Restarts the app at the end.
 */
export async function deleteAccount(): Promise<void> {
  const call = httpsCallable<{ confirm: "DELETE" }, { status: "ok" }>(getFunctions(undefined, "asia-south1"), "deleteAccount", {
    timeout: 540_000,
  });
  await call({ confirm: "DELETE" });

  clearUploadQueue();
  clearPersonalPreferences();
  // The account no longer exists; this only clears the local session.
  await signOut(getAuth()).catch(() => {});
  // The offline cache still holds the deleted inspections. It can only be cleared once Firestore has
  // stopped, and a stopped instance can't be reused, so the app restarts afterwards.
  try {
    await terminate(getFirestore());
    await clearPersistence(getFirestore());
  } catch (e) {
    console.warn("[account] cache clear failed", e);
  }
  await reloadAppAsync("Account deleted");
}
