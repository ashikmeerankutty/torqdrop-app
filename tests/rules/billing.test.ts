import { beforeAll, describe, expect, it } from "vitest";

// Point the Admin SDK at the emulator before it loads.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const PROJECT = "demo-torqdrop";

// firebase-admin lives in functions/node_modules, outside the app's type roots.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billing: any;

beforeAll(async () => {
  const { initializeApp, getApps } = await import("../../functions/node_modules/firebase-admin/lib/app/index.js");
  if (!getApps().length) initializeApp({ projectId: PROJECT });
  const { getFirestore } = await import("../../functions/node_modules/firebase-admin/lib/firestore/index.js");
  db = getFirestore();
  billing = await import("../../functions/src/billing");
});

const purchase = { purchaseState: 0, consumptionState: 0, orderId: "GPA.1234-5678" };

describe("grantPurchase", () => {
  it("adds a pack's reports once, however often the same purchase is sent", async () => {
    const token = `token-${Date.now()}`;
    const first = await billing.grantPurchase(db, "erin", "report_5", token, purchase);
    const again = await billing.grantPurchase(db, "erin", "report_5", token, purchase);
    expect(first).toEqual({ status: "granted", reports: 5 });
    expect(again).toEqual({ status: "already-granted", reports: 5 });

    const credits = (await db.doc("credits/erin").get()).data();
    expect(credits).toMatchObject({ balance: 5 });
    const payment = (await db.doc(`payments/${billing.paymentId(token)}`).get()).data();
    expect(payment).toMatchObject({ uid: "erin", productId: "report_5", reports: 5, orderId: "GPA.1234-5678" });
    const ledger = await db.collection("creditLedger").where("ownerUid", "==", "erin").get();
    expect(ledger.size).toBe(1);
  });

  it("adds to an existing balance without touching the free report", async () => {
    await db.doc("credits/finn").set({ balance: 2, freeUsed: 1 });
    await billing.grantPurchase(db, "finn", "report_20", `t-${Date.now()}`, purchase);
    expect((await db.doc("credits/finn").get()).data()).toMatchObject({ balance: 22, freeUsed: 1 });
  });

  it("refuses a token already redeemed by another account", async () => {
    const token = `shared-${Date.now()}`;
    await billing.grantPurchase(db, "gita", "report_1", token, purchase);
    await expect(billing.grantPurchase(db, "hari", "report_1", token, purchase)).rejects.toThrow("taken");
    expect((await db.doc("credits/hari").get()).exists).toBe(false);
  });
});
