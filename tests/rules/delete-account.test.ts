import { beforeAll, describe, expect, it } from "vitest";

// Point the Admin SDK at the emulators before it loads.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const PROJECT = "demo-torqdrop";
const BUCKET = `${PROJECT}.appspot.com`;

// firebase-admin lives in functions/node_modules, outside the app's type roots.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;

beforeAll(async () => {
  const { initializeApp, getApps } = await import("../../functions/node_modules/firebase-admin/lib/app/index.js");
  if (!getApps().length) initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const { getFirestore } = await import("../../functions/node_modules/firebase-admin/lib/firestore/index.js");
  const { getAuth } = await import("../../functions/node_modules/firebase-admin/lib/auth/index.js");
  const { getStorage } = await import("../../functions/node_modules/firebase-admin/lib/storage/index.js");
  const { deleteUserData } = await import("../../functions/src/delete-account");
  admin = { db: getFirestore(), auth: getAuth(), bucket: getStorage().bucket(), deleteUserData };
});

async function seedUser(uid: string) {
  const { db, auth, bucket } = admin;
  await auth.createUser({ uid }).catch(() => {});
  const insp = db.doc(`inspections/${uid}-insp`);
  await insp.set({ ownerUid: uid, status: "in_progress" });
  await insp.collection("sections").doc("engine").set({ items: {} });
  await insp.collection("evidence").doc("e1").set({ kind: "photo", storagePath: `inspection-photos/${uid}/${uid}-insp/e1.jpg` });
  await insp.collection("findings").doc("f1").set({ observedCondition: "x" });
  await db.doc(`reports/${uid}-rep`).set({ ownerUid: uid, inspectionId: insp.id });
  await db.doc(`reportShares/${uid}-share`).set({ ownerUid: uid, reportId: `${uid}-rep` });
  await db.doc(`vehicles/${uid}-veh`).set({ ownerUid: uid });
  await db.doc(`adapterSessions/${uid}-ad`).set({ ownerUid: uid });
  await db.doc(`aiUsage/${uid}-use`).set({ uid, fn: "analyzePhoto" });
  await db.doc(`users/${uid}`).set({ fullName: "Test User", email: `${uid}@example.com` });
  await db.doc(`aiQuota/${uid}`).set({ day: "2026-10-28", counts: {} });
  await db.doc(`credits/${uid}`).set({ balance: 4, freeUsed: 1 });
  await db.doc(`creditLedger/${uid}-led`).set({ ownerUid: uid, delta: 5, reason: "purchase" });
  await db.doc(`payments/${uid}-pay`).set({ uid, productId: "report_5", orderId: `GPA.${uid}` });
  await bucket.file(`inspection-photos/${uid}/${uid}-insp/e1.jpg`).save(Buffer.from([0xff, 0xd8, 0xff]));
}

describe("deleteUserData", () => {
  it("removes everything belonging to the user and nothing belonging to anyone else", async () => {
    await seedUser("carol");
    await seedUser("dave");

    const summary = await admin.deleteUserData("carol");
    expect(summary).toMatchObject({ inspections: 1, reports: 1, shareLinks: 1, vehicles: 1, adapterSessions: 1, aiUsage: 1, creditEntries: 1, photos: 1 });

    const { db, auth, bucket } = admin;
    const gone = [
      "inspections/carol-insp",
      "inspections/carol-insp/sections/engine",
      "inspections/carol-insp/evidence/e1",
      "inspections/carol-insp/findings/f1",
      "reports/carol-rep",
      "reportShares/carol-share",
      "vehicles/carol-veh",
      "adapterSessions/carol-ad",
      "aiUsage/carol-use",
      "users/carol",
      "aiQuota/carol",
      "credits/carol",
      "creditLedger/carol-led",
    ];
    for (const path of gone) expect((await db.doc(path).get()).exists, path).toBe(false);
    expect((await bucket.file("inspection-photos/carol/carol-insp/e1.jpg").exists())[0]).toBe(false);
    await expect(auth.getUser("carol")).rejects.toThrow();
    // The payment record stays for tax and refunds, unlinked from the account.
    expect((await db.doc("payments/carol-pay").get()).data()).toMatchObject({ uid: null, accountDeleted: true, orderId: "GPA.carol" });

    // Dave is untouched.
    for (const path of ["inspections/dave-insp/findings/f1", "reports/dave-rep", "users/dave", "aiUsage/dave-use", "credits/dave"]) {
      expect((await db.doc(path).get()).exists, path).toBe(true);
    }
    expect((await bucket.file("inspection-photos/dave/dave-insp/e1.jpg").exists())[0]).toBe(true);
    expect((await auth.getUser("dave")).uid).toBe("dave");
    expect((await db.doc("payments/dave-pay").get()).get("uid")).toBe("dave");
  });
});
