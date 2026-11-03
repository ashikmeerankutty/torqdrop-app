import { createHash } from "node:crypto";
import { type DocumentData, type Firestore, FieldValue, type Transaction } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { type CreditBalance, FREE_REPORTS, findPack } from "../../lib/billing/plans";

export const PACKAGE_NAME = "com.torqdrop.connect";
const PUBLISHER = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products`;

/**
 * Sent to Play as the purchase's obfuscated account ID, so a purchase token can only be redeemed by
 * the account that bought it. A hash, because Play forbids sending identifiers in the clear.
 */
export const accountTag = (uid: string) => createHash("sha256").update(uid).digest("hex");

/** Payments are keyed by the token's hash: idempotent, and the stored ID can't be replayed. */
export const paymentId = (token: string) => createHash("sha256").update(token).digest("hex");

/** The fields we use from Play's ProductPurchase resource. */
export interface PlayPurchase {
  /** 0 purchased, 1 cancelled, 2 pending. */
  purchaseState?: number;
  /** 0 not yet consumed, 1 consumed. */
  consumptionState?: number;
  orderId?: string;
  purchaseTimeMillis?: string;
  obfuscatedExternalAccountId?: string;
  /** Set for license testers' test purchases. */
  purchaseType?: number;
}

export type PurchaseCheck = "ok" | "pending" | "cancelled" | "consumed" | "wrong-account";

/** Whether a Play purchase may be turned into reports for this account. */
export function checkPurchase(p: PlayPurchase, uid: string): PurchaseCheck {
  if (p.purchaseState === 2) return "pending";
  if (p.purchaseState !== 0) return "cancelled";
  if (p.obfuscatedExternalAccountId && p.obfuscatedExternalAccountId !== accountTag(uid)) return "wrong-account";
  // We only consume after granting, so a consumed token we never recorded wasn't ours to grant.
  if (p.consumptionState === 1) return "consumed";
  return "ok";
}

/**
 * How signing off one report changes the balance: the free report first, then a paid one. Null when
 * there is nothing left.
 */
export function chargeForReport(c: CreditBalance): { next: CreditBalance; source: "free" | "paid" } | null {
  if (c.freeUsed < FREE_REPORTS) return { next: { ...c, freeUsed: c.freeUsed + 1 }, source: "free" };
  if (c.balance > 0) return { next: { ...c, balance: c.balance - 1 }, source: "paid" };
  return null;
}

export const readBalance = (data: DocumentData | undefined): CreditBalance => ({
  balance: typeof data?.balance === "number" ? data.balance : 0,
  freeUsed: typeof data?.freeUsed === "number" ? data.freeUsed : 0,
});

/** Calls the Google Play Developer API as the function's service account. */
export class PlayClient {
  private auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] });

  async get(productId: string, token: string): Promise<PlayPurchase> {
    const client = await this.auth.getClient();
    const url = `${PUBLISHER}/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
    return (await client.request<PlayPurchase>({ url })).data;
  }

  async consume(productId: string, token: string): Promise<void> {
    const client = await this.auth.getClient();
    const url = `${PUBLISHER}/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`;
    await client.request({ url, method: "POST" });
  }
}

export type GrantResult = { status: "granted" | "already-granted"; reports: number };

/**
 * Adds a verified purchase's reports to the account, once. The payment doc is created in the same
 * transaction as the balance change, so a retried call can't grant twice. Throws "taken" when the
 * token was already redeemed by another account.
 */
export async function grantPurchase(
  db: Firestore,
  uid: string,
  productId: string,
  token: string,
  purchase: PlayPurchase,
): Promise<GrantResult> {
  const pack = findPack(productId);
  if (!pack) throw new Error("unknown-product");
  const paymentRef = db.doc(`payments/${paymentId(token)}`);
  const creditsRef = db.doc(`credits/${uid}`);

  return db.runTransaction(async (tx: Transaction) => {
    const payment = await tx.get(paymentRef);
    if (payment.exists) {
      if (payment.get("uid") !== uid) throw new Error("taken");
      return { status: "already-granted" as const, reports: pack.reports };
    }
    const current = readBalance((await tx.get(creditsRef)).data());
    tx.create(paymentRef, {
      uid,
      provider: "google_play",
      productId,
      reports: pack.reports,
      orderId: purchase.orderId ?? null,
      purchaseTimeMillis: purchase.purchaseTimeMillis ? Number(purchase.purchaseTimeMillis) : null,
      test: purchase.purchaseType === 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(creditsRef, { ...current, balance: current.balance + pack.reports, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection("creditLedger").doc(), {
      ownerUid: uid,
      delta: pack.reports,
      reason: "purchase",
      productId,
      paymentId: paymentRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: "granted" as const, reports: pack.reports };
  });
}
