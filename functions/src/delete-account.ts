import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Query } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/** Everything stored for one user, by collection: what deleteAccount removes. */
export interface DeletionSummary {
  inspections: number;
  reports: number;
  shareLinks: number;
  vehicles: number;
  adapterSessions: number;
  aiUsage: number;
  creditEntries: number;
  photos: number;
}

async function deleteAll(query: Query): Promise<number> {
  const db = getFirestore();
  const snap = await query.get();
  const writer = db.bulkWriter();
  for (const d of snap.docs) void writer.delete(d.ref);
  await writer.close();
  return snap.size;
}

/**
 * Deletes a user's account and all their data: inspections with every section, photo record,
 * finding and OBD read; reports and share links; vehicles; adapter sessions; AI usage logs; quota;
 * report credits and their history; profile; uploaded photos; and finally the sign-in account
 * itself. Data goes first so a failure part-way can be retried by the still-signed-in user.
 *
 * Payment records are unlinked from the account rather than deleted: the order ID and amount are
 * kept for tax records and refunds, and the record still blocks the purchase being redeemed again.
 */
export async function deleteUserData(uid: string): Promise<DeletionSummary> {
  const db = getFirestore();

  const inspections = await db.collection("inspections").where("ownerUid", "==", uid).get();
  for (const d of inspections.docs) await db.recursiveDelete(d.ref);

  const [reports, shareLinks, vehicles, adapterSessions, aiUsage, creditEntries] = await Promise.all([
    deleteAll(db.collection("reports").where("ownerUid", "==", uid)),
    deleteAll(db.collection("reportShares").where("ownerUid", "==", uid)),
    deleteAll(db.collection("vehicles").where("ownerUid", "==", uid)),
    deleteAll(db.collection("adapterSessions").where("ownerUid", "==", uid)),
    deleteAll(db.collection("aiUsage").where("uid", "==", uid)),
    deleteAll(db.collection("creditLedger").where("ownerUid", "==", uid)),
  ]);
  await Promise.all([db.doc(`users/${uid}`).delete(), db.doc(`aiQuota/${uid}`).delete(), db.doc(`credits/${uid}`).delete()]);

  const payments = await db.collection("payments").where("uid", "==", uid).get();
  const unlink = db.bulkWriter();
  for (const d of payments.docs) void unlink.update(d.ref, { uid: null, accountDeleted: true });
  await unlink.close();

  const bucket = getStorage().bucket();
  const prefix = `inspection-photos/${uid}/`;
  const [files] = await bucket.getFiles({ prefix });
  await bucket.deleteFiles({ prefix, force: true });
  // Engine clips are deleted after analysis; this catches any left by an upload that was never analysed.
  await bucket.deleteFiles({ prefix: `engine-clips/${uid}/`, force: true });

  await getAuth().deleteUser(uid);

  return { inspections: inspections.size, reports, shareLinks, vehicles, adapterSessions, aiUsage, creditEntries, photos: files.length };
}
