import { doc, getFirestore, onSnapshot } from "@react-native-firebase/firestore";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import { useEffect, useState } from "react";

import { useSession } from "@/lib/auth/session";
import type { CreditBalance } from "@/lib/billing/plans";

export type VerifyPurchaseResult = { status: "ok"; granted: boolean; reports: number } | { status: "pending" };

/** Hands a Play purchase to the server, which checks it with Google and adds the reports. */
export async function verifyPurchase(productId: string, purchaseToken: string): Promise<VerifyPurchaseResult> {
  const call = httpsCallable<{ productId: string; purchaseToken: string }, VerifyPurchaseResult>(
    getFunctions(undefined, "asia-south1"),
    "verifyPurchase",
    { timeout: 60_000 },
  );
  return (await call({ productId, purchaseToken })).data;
}

/** The signed-in user's report balance. Null while loading; zeros before the first purchase. */
export function useCredits(): CreditBalance | null {
  const { user } = useSession();
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(getFirestore(), "credits", user.uid),
      (snap) => {
        const d = snap.data();
        setCredits({ balance: d?.balance ?? 0, freeUsed: d?.freeUsed ?? 0 });
      },
      (e) => console.warn("[credits] read failed", e),
    );
  }, [user]);
  return credits;
}

/** True when finalizeReport refused because the account has no reports left. */
export const isOutOfCredits = (e: unknown) =>
  (e as { details?: { reason?: string } })?.details?.reason === "no-credits";
