import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import type { PhotoEvidence } from '@/lib/firebase/inspections';
import { localPhotoUri, remotePhotoUrl } from '@/lib/firebase/upload-queue';

/** Shows the local copy while a photo is waiting to upload, then the uploaded file. */
export function PhotoThumb({ photo }: { photo: PhotoEvidence }) {
  const local = localPhotoUri(photo.id);
  const [remote, setRemote] = useState<string | null>(null);

  useEffect(() => {
    if (local || photo.uploadState !== 'uploaded') return;
    let cancelled = false;
    remotePhotoUrl(photo.storagePath)
      .then((url) => !cancelled && setRemote(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [local, photo.storagePath, photo.uploadState]);

  const uri = local ?? remote;
  return (
    <View style={styles.box}>
      {uri ? <Image source={{ uri }} style={styles.image} /> : <ActivityIndicator />}
      {photo.uploadState === 'pending' && <View style={styles.pending} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: '#8884', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  // Small amber dot: saved on the phone, not uploaded yet.
  pending: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#ef6c00',
  },
});
