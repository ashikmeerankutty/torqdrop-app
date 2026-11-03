import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import Colors from '@/constants/Colors';
import { radius, space } from '@/constants/Theme';
import { type CheckStage, type ClipSetup, clipContext, runEngineCheck, startObdTrace } from '@/lib/engine-check';
import { aiErrorMessage } from '@/lib/firebase/ai';
import { useObd } from '@/lib/obd/connection';
import { useLive } from '@/lib/obd/live';
import type { ObdTracePoint } from '@/lib/schemas/engine-sound';
import { MAX_CLIP_BYTES, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from '@/lib/schemas/engine-sound';

const ORANGE = Colors.dark.primary;

/** The guided script: what to do at each point of the clip. */
const PHASES = [
  { until: 7, title: 'Hold steady', body: 'Engine at idle. Keep the phone still.' },
  { until: 13, title: 'One gentle rev', body: 'Rev to about 3,000 rpm and hold for a second.' },
  { until: MAX_CLIP_SECONDS, title: 'Back to idle', body: 'Let the engine settle back to idle.' },
];

type Phase = 'ready' | 'recording' | 'recorded' | 'working' | 'failed';

/** Full-screen guided engine recording, then upload and AI analysis. */
export default function EngineRecord() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ setup: string }>();
  const [setup] = useState<ClipSetup>(() => JSON.parse(params.setup ?? '{}'));
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const obd = useObd();
  const rpm = useLive('rpm');
  const [cameraReady, setCameraReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ uri: string; durationS: number; trace: ObdTracePoint[] } | null>(null);
  const [stage, setStage] = useState<CheckStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const trace = useRef<{ stop: () => ObdTracePoint[] } | null>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Stop the OBD trace if the screen closes mid-recording.
  useEffect(() => () => void trace.current?.stop(), []);

  async function start() {
    if (!camera.current || !cameraReady) return;
    setError(null);
    setElapsed(0);
    setPhase('recording');
    startedAt.current = Date.now();
    trace.current = startObdTrace();
    try {
      const res = await camera.current.recordAsync({ maxDuration: MAX_CLIP_SECONDS, maxFileSize: MAX_CLIP_BYTES });
      const durationS = (Date.now() - startedAt.current) / 1000;
      const points = trace.current?.stop() ?? [];
      trace.current = null;
      if (!res?.uri) throw new Error('The recording was not saved.');
      if (durationS < MIN_CLIP_SECONDS) {
        setPhase('ready');
        setError(`That was too short. Record at least ${MIN_CLIP_SECONDS} seconds.`);
        return;
      }
      setClip({ uri: res.uri, durationS: Math.min(durationS, MAX_CLIP_SECONDS), trace: points.filter((p) => p.t <= durationS + 0.5) });
      setPhase('recorded');
    } catch (e) {
      trace.current?.stop();
      trace.current = null;
      setPhase('ready');
      setError(e instanceof Error ? e.message : 'Recording failed. Try again.');
    }
  }

  function stop() {
    if (elapsed >= MIN_CLIP_SECONDS) camera.current?.stopRecording();
  }

  async function analyse() {
    if (!clip) return;
    setPhase('working');
    setError(null);
    try {
      const context = await clipContext(setup, clip.durationS, clip.trace);
      const r = await runEngineCheck(clip.uri, context, setStage);
      if (r.status === 'ok') {
        router.replace({ pathname: '/engine-check/[id]', params: { id: r.check.id } });
        return;
      }
      setClip(null);
      setError("The AI couldn't make sense of this clip. Record it again, a little closer to the engine.");
      setPhase('failed');
    } catch (e) {
      // The clip is still on the phone, so this can be retried.
      const code = (e as { code?: string })?.code ?? '';
      setError(code.startsWith('storage/') ? 'The upload failed. Check your connection and try again.' : aiErrorMessage(e));
      setPhase('recorded');
    } finally {
      setStage(null);
    }
  }

  if (!cam || !mic) return <View style={styles.black} />;
  if (!cam.granted || !mic.granted) {
    const canAsk = (cam.granted || cam.canAskAgain) && (mic.granted || mic.canAskAgain);
    return (
      <View style={[styles.black, styles.center, { padding: space.xl, gap: space.md }]}>
        <Icon name="mic" size={40} color="#fff" />
        <Text style={styles.white} variant="heading">
          Camera and microphone needed
        </Text>
        <Text style={[styles.white, styles.centerText]}>The engine check records a short video with sound. Most of the diagnosis comes from the sound.</Text>
        {canAsk ? (
          <Button
            title="Allow camera and microphone"
            onPress={async () => {
              if (!cam.granted) await requestCam();
              if (!mic.granted) await requestMic();
            }}
          />
        ) : (
          <Button title="Open Settings" onPress={() => Linking.openSettings()} />
        )}
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  if (phase === 'working') {
    const uploading = stage?.step === 'uploading';
    return (
      <View style={[styles.black, styles.center, { padding: space.xl, gap: space.lg }]}>
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.white} variant="heading">
          {uploading ? `Uploading clip… ${Math.round((stage.progress ?? 0) * 100)}%` : 'Listening to your engine…'}
        </Text>
        <Text style={[styles.white, styles.dim, styles.centerText]}>
          {uploading
            ? 'Keep the app open.'
            : obd.status === 'connected'
              ? 'Matching the sound with the rpm and load recorded from the adapter. This takes up to a minute.'
              : 'Checking the idle rhythm and listening for knocks, ticks and squeals. This takes up to a minute.'}
        </Text>
      </View>
    );
  }

  const current = PHASES.find((p) => elapsed < p.until) ?? PHASES[PHASES.length - 1];
  const recording = phase === 'recording';

  return (
    <View style={styles.black}>
      <CameraView
        ref={camera}
        style={styles.fill}
        facing="back"
        mode="video"
        videoQuality="720p"
        videoBitrate={4_000_000}
        enableTorch={torch}
        onCameraReady={() => setCameraReady(true)}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" style={styles.roundButton} disabled={recording}>
          <Icon name="close" size={22} color="#fff" />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text variant="bodyStrong" style={[styles.white, styles.centerText]}>
            Engine sound check
          </Text>
          {typeof rpm === 'number' && (
            <Text variant="caption" style={[styles.white, styles.centerText]}>
              {Math.round(rpm).toLocaleString()} rpm{obd.simulated ? ' (simulated)' : ''}
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

      <View style={[styles.guide, { bottom: insets.bottom + 140 }]}>
        {phase === 'recorded' && clip ? (
          <>
            <Text variant="heading" style={styles.white}>
              Clip recorded · {Math.round(clip.durationS)} s
            </Text>
            <Text variant="caption" style={[styles.white, styles.dim]}>
              {clip.trace.length ? `With ${clip.trace.length} engine readings from the adapter.` : 'No adapter data with this clip.'}
            </Text>
          </>
        ) : recording ? (
          <>
            <Text variant="title" style={styles.white}>
              {current.title}
            </Text>
            <Text style={[styles.white, styles.dim]}>{current.body}</Text>
            <View style={styles.progressTrack}>
              {PHASES.map((p, i) => {
                const from = i ? PHASES[i - 1].until : 0;
                const fill = Math.min(1, Math.max(0, (elapsed - from) / (p.until - from)));
                return (
                  <View key={p.title} style={[styles.segment, { flex: p.until - from }]}>
                    <View style={[styles.segmentFill, { width: `${fill * 100}%` }]} />
                  </View>
                );
              })}
            </View>
            <Text variant="caption" style={[styles.white, styles.dim]}>
              {Math.floor(elapsed)} / {MAX_CLIP_SECONDS} s
            </Text>
          </>
        ) : (
          <>
            <Text variant="heading" style={styles.white}>
              Point the camera at the engine
            </Text>
            <Text variant="caption" style={[styles.white, styles.dim]}>
              30–50 cm away, fingers off the microphone. Recording runs {MAX_CLIP_SECONDS} seconds with prompts.
            </Text>
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.xl }]}>
        {phase === 'recorded' ? (
          <View style={styles.reviewRow}>
            <Button
              title="Record again"
              icon="videocam"
              variant="secondary"
              onPress={() => {
                setClip(null);
                setPhase('ready');
              }}
              style={styles.grow}
            />
            <Button title="Analyse" icon="ai" onPress={analyse} style={styles.grow} />
          </View>
        ) : (
          <Pressable
            onPress={recording ? stop : start}
            disabled={!cameraReady || (recording && elapsed < MIN_CLIP_SECONDS)}
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            style={({ pressed }) => [styles.shutter, { opacity: !cameraReady ? 0.4 : pressed ? 0.7 : 1 }]}>
            <View style={recording ? styles.stopSquare : styles.recordDot} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  fill: StyleSheet.absoluteFill,
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  white: { color: '#fff' },
  dim: { opacity: 0.8 },
  error: { color: '#ffb4a8', fontWeight: '600' },
  grow: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.md },
  titleBlock: { flex: 1 },
  roundButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  guide: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    padding: space.lg,
    gap: space.xs,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  progressTrack: { flexDirection: 'row', gap: 4, marginTop: space.sm },
  segment: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  segmentFill: { height: 6, backgroundColor: ORANGE },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: space.lg },
  reviewRow: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recordDot: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#e53935' },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#e53935' },
});
