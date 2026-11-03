import { getDownloadURL, getStorage, putFile, ref } from "@react-native-firebase/storage";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Network from "expo-network";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { markPhotoUploaded } from "./inspections";

/**
 * Photos are kept in app storage and uploaded when the network allows, so capture never waits on
 * signal. The queue is a JSON file next to the photos, so it survives restarts.
 */

interface Entry {
  evidenceId: string;
  inspectionId: string;
  storagePath: string;
  attempts: number;
}

/** Long edge after downscaling. Keeps AI input cost and upload size down. */
const MAX_EDGE = 1280;
const MAX_RETRY_MS = 5 * 60 * 1000;

const dir = new Directory(Paths.document, "upload-queue");
const queueFile = new File(dir, "queue.json");
const photoFile = (evidenceId: string) => new File(dir, `${evidenceId}.jpg`);

let entries: Entry[] | null = null;
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function load(): Entry[] {
  if (!entries) {
    dir.create({ intermediates: true, idempotent: true });
    entries = queueFile.exists ? (JSON.parse(queueFile.textSync()) as Entry[]) : [];
  }
  return entries;
}

async function persist() {
  if (!queueFile.exists) queueFile.create();
  await queueFile.write(JSON.stringify(entries ?? []));
  listeners.forEach((l) => l());
}

/** Downscale to MAX_EDGE on the long side and re-encode as JPEG. */
export async function preparePhoto(
  uri: string,
  width: number,
  height: number,
  opts: { maxEdge?: number; base64?: boolean } = {},
) {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > maxEdge) {
    context.resize(width >= height ? { width: maxEdge, height: null } : { width: null, height: maxEdge });
  }
  const image = await context.renderAsync();
  return image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: opts.base64 ?? false });
}

export async function enqueuePhoto(entry: Omit<Entry, "attempts">, sourceUri: string) {
  load();
  await new File(sourceUri).copy(photoFile(entry.evidenceId));
  entries!.push({ ...entry, attempts: 0 });
  await persist();
  void drain();
}

/** Deletes every queued photo and the queue itself, e.g. after the account is deleted. */
export function clearUploadQueue() {
  clearTimeout(retryTimer);
  entries = [];
  if (dir.exists) dir.delete();
  listeners.forEach((l) => l());
}

/** Local copy of a photo that hasn't finished uploading, or null. */
export function localPhotoUri(evidenceId: string): string | null {
  const file = photoFile(evidenceId);
  return file.exists ? file.uri : null;
}

const urlCache = new Map<string, Promise<string>>();

/** Download URL for an uploaded photo. Cached per path for the session. */
export function remotePhotoUrl(storagePath: string): Promise<string> {
  let url = urlCache.get(storagePath);
  if (!url) {
    url = getDownloadURL(ref(getStorage(), storagePath));
    url.catch(() => urlCache.delete(storagePath));
    urlCache.set(storagePath, url);
  }
  return url;
}

async function drain() {
  if (draining) return;
  draining = true;
  clearTimeout(retryTimer);
  try {
    for (const entry of [...load()]) {
      const file = photoFile(entry.evidenceId);
      if (file.exists) {
        try {
          await putFile(ref(getStorage(), entry.storagePath), file.uri, { contentType: "image/jpeg" });
        } catch (e) {
          // Most likely offline. Stop and retry later rather than hammering every entry.
          console.warn("[upload-queue] upload failed", entry.storagePath, e);
          entry.attempts += 1;
          await persist();
          retryTimer = setTimeout(drain, Math.min(MAX_RETRY_MS, 5000 * 2 ** entry.attempts));
          return;
        }
        markPhotoUploaded(entry.inspectionId, entry.evidenceId).catch((e) =>
          console.warn("[upload-queue] mark uploaded failed", e),
        );
        file.delete();
      }
      entries = load().filter((e) => e.evidenceId !== entry.evidenceId);
      await persist();
    }
  } finally {
    draining = false;
  }
}

/** Starts draining on launch, when the network comes back, and when the app returns to the foreground. */
export function startUploadQueue(): () => void {
  void drain();
  const network = Network.addNetworkStateListener((state) => {
    if (state.isInternetReachable) void drain();
  });
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") void drain();
  });
  return () => {
    network.remove();
    appState.remove();
    clearTimeout(retryTimer);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Number of photos still waiting to upload. */
export function usePendingUploads(): number {
  return useSyncExternalStore(subscribe, () => load().length);
}
