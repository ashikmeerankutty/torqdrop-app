import { useCallback, useRef, useState } from "react";

import { useCapture } from "@/components/camera/CameraProvider";
import type { ScanState } from "@/components/inspection/ScanSheet";
import type { DocumentKind, DocumentScan } from "@/lib/schemas/document";

import { type DocumentPhoto, readDocumentPhoto, takeDocumentPhoto } from "./scan";

/**
 * Drives the scan flow for a screen: camera, then reading, then the confirm sheet. The photo of the
 * last successful scan is kept so the screen can file it as evidence when answers are applied.
 */
export function useDocumentScan() {
  const [state, setState] = useState<ScanState | null>(null);
  const photo = useRef<DocumentPhoto | null>(null);
  const capture = useCapture();

  const start = useCallback(async (kind: DocumentKind) => {
    let shot: DocumentPhoto | null;
    try {
      shot = await takeDocumentPhoto(kind, capture);
    } catch (e) {
      setState({ phase: "error", kind, message: e instanceof Error ? e.message : "Couldn't open the camera." });
      return;
    }
    if (!shot) return;
    photo.current = shot;
    setState({ phase: "reading", kind });
    const r = await readDocumentPhoto(kind, shot);
    setState(r.status === "ok" ? { phase: "result", kind, scan: r.scan } : { phase: "error", kind, message: r.message });
  }, [capture]);

  const close = useCallback(() => setState(null), []);
  const retake = useCallback(() => {
    if (state) void start(state.kind);
  }, [state, start]);

  return {
    state,
    start,
    retake,
    close,
    /** The scan and photo behind the current result, for applying. */
    current: (): { scan: DocumentScan; photo: DocumentPhoto } | null =>
      state?.phase === "result" && photo.current ? { scan: state.scan, photo: photo.current } : null,
  };
}
