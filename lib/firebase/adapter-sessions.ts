import { getAuth } from "@react-native-firebase/auth";
import { addDoc, collection, getFirestore, serverTimestamp } from "@react-native-firebase/firestore";

/** Logs each adapter connection; feeds the vehicle/adapter compatibility data later (Phase 2). */
export function recordAdapterSession(s: { adapterModel: string; protocol: string | null; supportedPids: number[]; simulated: boolean }) {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return;
  addDoc(collection(getFirestore(), "adapterSessions"), {
    ownerUid: uid,
    ...s,
    connectedAt: serverTimestamp(),
  }).catch((e) => console.warn("[adapter-sessions] write failed", e));
}
