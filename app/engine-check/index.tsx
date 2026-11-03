import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { EngineCheckRow } from '@/components/engine/EngineCheckRow';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { useDbQuery } from '@/lib/db/use-query';
import { listEngineChecks, type ClipSetup } from '@/lib/engine-check';
import { useObd } from '@/lib/obd/connection';
import { useMetricsVehicle } from '@/lib/obd/metrics';
import { CLIP_PLACES, type ClipPlace, ENGINE_CONCERNS, type EngineConcern, MAX_CLIP_SECONDS } from '@/lib/schemas/engine-sound';

const PLACES = Object.keys(CLIP_PLACES) as ClipPlace[];
const CONCERNS = Object.keys(ENGINE_CONCERNS) as EngineConcern[];

/** Engine sound check: set up what to listen for, then record a short guided clip for the AI. */
export default function EngineCheckSetup() {
  const obd = useObd();
  const vehicle = useMetricsVehicle();
  const connected = obd.status === 'connected';
  const [place, setPlace] = useState<ClipPlace>('engine_bay');
  const [engineWarm, setEngineWarm] = useState<boolean | null>(null);
  const [concerns, setConcerns] = useState<EngineConcern[]>([]);
  const [description, setDescription] = useState('');
  const vehicleId = connected && !obd.simulated ? (obd.vehicleId ?? null) : null;
  const { data: history } = useDbQuery(() => listEngineChecks(vehicleId, 10), [vehicleId], ['engine_checks']);

  function record() {
    const setup: ClipSetup = { place, engineWarm, concerns, description };
    router.push({ pathname: '/engine-check/record', params: { setup: JSON.stringify(setup) } });
  }

  return (
    <Screen footer={<Button title="Record the engine" icon="videocam" size="lg" onPress={record} />}>
      <Card>
        <View style={styles.row}>
          <Icon name="hearing" size={28} tone="primary" />
          <View style={styles.grow}>
            <Text variant="heading">Let AI listen to your engine</Text>
            <Text variant="caption" tone="textMuted">
              A {MAX_CLIP_SECONDS}-second video with sound. The AI listens for knocks, ticks, squeals and misfires, and watches for smoke or
              leaks.
            </Text>
          </View>
        </View>
        <Step icon="engine" text="Start the engine and let it idle. Park somewhere quiet, away from traffic and wind." />
        <Step icon="videocam" text="Hold the phone steady 30–50 cm from the engine. Keep your fingers off the microphone and stay clear of the fan and belts." />
        <Step icon="timer" text="On screen prompts: idle, one gentle rev to about 3,000 rpm, then back to idle. Ask someone to rev it for you." />
        <View style={styles.row}>
          <Icon name={connected ? 'bluetooth' : 'info'} size={16} tone={connected ? 'primary' : 'textMuted'} />
          <Text variant="caption" tone="textMuted" style={styles.grow}>
            {connected
              ? `${obd.simulated ? 'Simulated' : 'Live'} engine data from the adapter is recorded with the clip, so the AI can match sounds to rpm and load.`
              : 'Connect your OBD adapter first for a sharper diagnosis: the AI then matches each sound to engine speed and load.'}
          </Text>
        </View>
        {!connected && <Button title="Connect adapter" icon="bluetooth" variant="secondary" onPress={() => router.push('/connect')} />}
      </Card>

      <Card>
        <Text variant="heading">Where will you record?</Text>
        <View style={styles.chips}>
          {PLACES.map((p) => (
            <Chip key={p} label={CLIP_PLACES[p]} selected={place === p} onPress={() => setPlace(p)} />
          ))}
        </View>
        <Text variant="heading">Is the engine warm?</Text>
        <View style={styles.chips}>
          <Chip label="Cold start" selected={engineWarm === false} onPress={() => setEngineWarm(engineWarm === false ? null : false)} />
          <Chip label="Warmed up" selected={engineWarm === true} onPress={() => setEngineWarm(engineWarm === true ? null : true)} />
        </View>
      </Card>

      <Card>
        <Text variant="heading">What have you noticed?</Text>
        <Text variant="caption" tone="textMuted">
          Optional. Leave empty for a general check-up.
        </Text>
        <View style={styles.chips}>
          {CONCERNS.map((c) => (
            <Chip
              key={c}
              label={ENGINE_CONCERNS[c]}
              selected={concerns.includes(c)}
              onPress={() => setConcerns((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))}
            />
          ))}
        </View>
        <TextField
          label="When does it happen? (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. ticking for the first minute after a cold start"
          multiline
          maxLength={300}
          hint="Don't include names or phone numbers."
        />
      </Card>

      {!!history?.length && (
        <Card>
          <Text variant="heading">Past checks{vehicle && vehicle.id !== 'simulated' ? ` · ${vehicle.name}` : ''}</Text>
          {history.map((c) => (
            <EngineCheckRow key={c.id} check={c} />
          ))}
        </Card>
      )}

      <Text variant="caption" tone="textSubtle" style={styles.center}>
        The clip is uploaded for analysis and deleted straight after. Only the result is kept, on this phone.
      </Text>
    </Screen>
  );
}

function Step({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.step}>
      <Icon name={icon} size={18} tone="textMuted" />
      <Text variant="caption" style={styles.grow}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  center: { textAlign: 'center' },
});
