import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import Colors from '@/constants/Colors';
import { radius, space } from '@/constants/Theme';

import type { CapturedPhoto, CaptureOptions } from './CameraProvider';

const ORANGE = Colors.dark.primary;

/** Full-screen back-camera capture with torch, an optional document frame, and a review step. */
export default function InAppCamera({ options, onDone }: { options: CaptureOptions; onDone: (photo: CapturedPhoto | null) => void }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<CapturedPhoto | null>(null);

  async function takePhoto() {
    if (!camera.current || !ready || busy) return;
    setBusy(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 1 });
      if (pic) setShot({ uri: pic.uri, width: pic.width, height: pic.height });
    } finally {
      setBusy(false);
    }
  }

  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.center, { padding: space.xl }]}>
        <Icon name="camera" size={40} color="#fff" />
        <Text style={styles.white} variant="heading">
          Camera access needed
        </Text>
        <Text style={[styles.white, styles.centerText]}>TorqDrop uses the camera to photograph the car and its documents.</Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open Settings" onPress={() => Linking.openSettings()} />
        )}
        <Button title="Cancel" variant="ghost" onPress={() => onDone(null)} />
      </View>
    );
  }

  if (shot) {
    return (
      <View style={styles.black}>
        <Image source={{ uri: shot.uri }} style={styles.fill} resizeMode="contain" />
        <View style={[styles.reviewBar, { paddingBottom: insets.bottom + space.lg }]}>
          <Button title="Retake" icon="camera" variant="secondary" onPress={() => setShot(null)} style={styles.grow} />
          <Button title="Use photo" icon="check" onPress={() => onDone(shot)} style={styles.grow} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.black}>
      <CameraView
        ref={camera}
        style={styles.fill}
        facing="back"
        enableTorch={torch}
        animateShutter
        onCameraReady={() => setReady(true)}
      />

      {options.frame === 'document' && (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.docFrame} />
        </View>
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => onDone(null)} hitSlop={12} accessibilityLabel="Close camera" style={styles.roundButton}>
          <Icon name="close" size={22} color="#fff" />
        </Pressable>
        <View style={styles.titleBlock}>
          {options.title && (
            <Text variant="bodyStrong" style={[styles.white, styles.centerText]} numberOfLines={1}>
              {options.title}
            </Text>
          )}
          {options.hint && (
            <Text variant="caption" style={[styles.white, styles.centerText, styles.dim]} numberOfLines={2}>
              {options.hint}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => setTorch((t) => !t)}
          hitSlop={12}
          accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
          style={[styles.roundButton, torch && { backgroundColor: ORANGE }]}>
          <Icon name="electricals" size={20} color={torch ? '#140A03' : '#fff'} />
        </Pressable>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
        <Pressable
          onPress={takePhoto}
          disabled={!ready || busy}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          style={({ pressed }) => [styles.shutter, { opacity: !ready ? 0.4 : pressed ? 0.7 : 1 }]}>
          {busy ? <ActivityIndicator color="#140A03" /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md },
  centerText: { textAlign: 'center' },
  white: { color: '#fff' },
  dim: { opacity: 0.85 },
  grow: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  titleBlock: { flex: 1, gap: 2 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // An RC smart card and a folded policy page are both close to this shape.
  docFrame: { width: '86%', aspectRatio: 1.45, borderWidth: 3, borderColor: ORANGE, borderRadius: radius.lg },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: space.lg },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: ORANGE },
  reviewBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
