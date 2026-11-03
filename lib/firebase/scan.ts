import type { CapturedPhoto, CaptureOptions } from "@/components/camera/CameraProvider";
import type { DocumentKind, DocumentScan } from "@/lib/schemas/document";

import { aiErrorMessage, scanDocument } from "./ai";
import { preparePhoto } from "./upload-queue";

export interface DocumentPhoto {
  uri: string;
  width: number;
  height: number;
  base64: string;
}

/** Document text is small; a larger edge than inspection photos keeps it readable. */
const DOCUMENT_EDGE = 1600;

/** Opens the camera for a document. Null if cancelled; throws with a user-facing message on failure. */
export async function takeDocumentPhoto(
  kind: DocumentKind,
  capture: (opts?: CaptureOptions) => Promise<CapturedPhoto | null>,
): Promise<DocumentPhoto | null> {
  const asset = await capture({
    title: kind === "rc" ? "Scan the RC" : "Scan the insurance policy",
    hint: "Lay it flat in good light and fit it inside the frame",
    frame: "document",
  });
  if (!asset) return null;
  const photo = await preparePhoto(asset.uri, asset.width, asset.height, { maxEdge: DOCUMENT_EDGE, base64: true });
  if (!photo.base64) throw new Error("Couldn't prepare the photo. Try again.");
  return { uri: photo.uri, width: photo.width, height: photo.height, base64: photo.base64 };
}

/** Has the AI read a document photo. Needs a connection. */
export async function readDocumentPhoto(
  kind: DocumentKind,
  photo: DocumentPhoto,
): Promise<{ status: "ok"; scan: DocumentScan } | { status: "error"; message: string }> {
  try {
    const r = await scanDocument(kind, photo.base64);
    if (r.status === "ai_unavailable") return { status: "error", message: "The AI couldn't read the document this time. Try again." };
    return { status: "ok", scan: r.scan };
  } catch (e) {
    return { status: "error", message: aiErrorMessage(e) };
  }
}
