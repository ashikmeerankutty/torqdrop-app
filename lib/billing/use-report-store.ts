import * as Crypto from "expo-crypto";
import { finishTransaction, isUserCancelledError, type Purchase, useIAP } from "expo-iap";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/auth/session";
import { aiErrorMessage } from "@/lib/firebase/ai";
import { verifyPurchase } from "@/lib/firebase/billing";

import { findPack, REPORT_PACKS } from "./plans";

const SKUS = REPORT_PACKS.map((p) => p.id);

export type StoreNotice = { tone: "success" | "info" | "danger"; text: string };

/**
 * Google Play report packs: Play's prices, buying, and handing each purchase to the server, which
 * adds the reports. Purchases left unfinished (the app closed mid-way, or a UPI payment that
 * completed later) are picked up and settled whenever this hook is mounted.
 */
export function useReportStore() {
  const { user } = useSession();
  const [buying, setBuying] = useState<string | null>(null);
  const [notice, setNotice] = useState<StoreNotice | null>(null);
  const settling = useRef(new Set<string>());

  const settle = useCallback(async (purchase: Purchase) => {
    const token = purchase.purchaseToken;
    const pack = findPack(purchase.productId);
    if (!token || !pack || settling.current.has(token)) return;
    if (purchase.purchaseState === "pending") {
      setNotice({ tone: "info", text: "Your payment is pending. The reports are added as soon as Google Play confirms it." });
      return;
    }
    settling.current.add(token);
    try {
      const result = await verifyPurchase(purchase.productId, token);
      if (result.status === "pending") {
        setNotice({ tone: "info", text: "Your payment is pending. The reports are added as soon as Google Play confirms it." });
        return;
      }
      // The server consumes the purchase too; this only covers its consume failing.
      await finishTransaction({ purchase, isConsumable: true }).catch(() => {});
      if (result.granted) {
        setNotice({ tone: "success", text: `${pack.reports} report${pack.reports === 1 ? "" : "s"} added to your account.` });
      }
    } catch (e) {
      setNotice({ tone: "danger", text: `${aiErrorMessage(e)} Your payment is safe and will be added when you next open Plans.` });
    } finally {
      settling.current.delete(token);
      setBuying(null);
    }
  }, []);

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => void settle(purchase),
    onPurchaseError: (error) => {
      setBuying(null);
      if (!isUserCancelledError(error)) setNotice({ tone: "danger", text: error.message || "The purchase didn't go through." });
    },
  });
  const { connected, fetchProducts, getAvailablePurchases, availablePurchases } = iap;

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: SKUS, type: "in-app" }).catch(() => {});
    getAvailablePurchases().catch(() => {});
  }, [connected, fetchProducts, getAvailablePurchases]);

  useEffect(() => {
    for (const p of availablePurchases) void settle(p);
  }, [availablePurchases, settle]);

  async function buy(productId: string) {
    if (!user || buying) return;
    setNotice(null);
    setBuying(productId);
    try {
      // Ties the purchase to this account, so the token can't be redeemed by another one.
      const obfuscatedAccountId = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, user.uid);
      await iap.requestPurchase({ request: { google: { skus: [productId], obfuscatedAccountId } }, type: "in-app" });
    } catch (e) {
      setBuying(null);
      if (!isUserCancelledError(e as never)) setNotice({ tone: "danger", text: "Couldn't open Google Play. Try again." });
    }
  }

  /** Play's price for a pack ("₹199.00" and 199), once products have loaded. */
  const priceOf = (id: string) => {
    const p = iap.products.find((x) => x.id === id);
    return p ? { label: p.displayPrice, amount: p.price ?? null } : undefined;
  };

  return { connected, loaded: iap.products.length > 0, priceOf, buy, buying, notice, dismissNotice: () => setNotice(null) };
}
