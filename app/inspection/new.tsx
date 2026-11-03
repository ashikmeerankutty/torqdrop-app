import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { ScanSheet } from '@/components/inspection/ScanSheet';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { RegPlate } from '@/components/ui/RegPlate';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { useSession } from '@/lib/auth/session';
import type { ItemRecord } from '@/lib/diagnostics/checklists/types';
import type { ScannedAnswer } from '@/lib/diagnostics/document-fields';
import { addPhotoEvidence, createInspection } from '@/lib/firebase/inspections';
import type { DocumentPhoto } from '@/lib/firebase/scan';
import { enqueuePhoto } from '@/lib/firebase/upload-queue';
import { useDocumentScan } from '@/lib/firebase/use-document-scan';

const FUELS = ['Petrol', 'Diesel', 'CNG', 'EV', 'Hybrid'];
/** Scanned answers that go into the form fields; the rest are saved with the inspection. */
const FORM_ITEMS = new Set(['reg_no', 'make', 'model', 'variant', 'fuel_type']);
const TRANSMISSIONS = ['Manual', 'Automatic'];
// The most common makes on Indian roads, so most people tap instead of type.
const POPULAR_MAKES = ['Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Kia', 'Toyota', 'Honda'];

type Form = { regNo: string; make: string; model: string; variant: string; year: string; odometer: string };
type Errors = Partial<Record<keyof Form | 'fuel' | 'transmission', string>>;

export default function NewInspectionScreen() {
  const { user } = useSession();
  const [form, setForm] = useState<Form>({ regNo: '', make: '', model: '', variant: '', year: '', odometer: '' });
  const [fuel, setFuel] = useState<string | null>(null);
  const [transmission, setTransmission] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const scan = useDocumentScan();
  // Scanned answers that aren't form fields, saved when the inspection is created, plus the RC photo.
  const [scanned, setScanned] = useState<{ extra: Record<string, Record<string, ItemRecord>>; count: number; photo: DocumentPhoto } | null>(
    null,
  );

  function applyScan(answers: ScannedAnswer[]) {
    const current = scan.current();
    scan.close();
    if (!current) return;
    const value = (key: string) => answers.find((a) => a.itemKey === key)?.value;
    const str = (key: string) => (typeof value(key) === 'string' ? (value(key) as string) : undefined);
    setForm((f) => ({
      ...f,
      regNo: str('reg_no') ?? f.regNo,
      make: str('make') ?? f.make,
      model: str('model') ?? f.model,
      variant: str('variant') ?? f.variant,
      year: str('mfg_month_year')?.slice(3) ?? f.year,
    }));
    const fuelValue = str('fuel_type');
    if (fuelValue && FUELS.includes(fuelValue)) setFuel(fuelValue);
    setErrors({});

    const extra: Record<string, Record<string, ItemRecord>> = {};
    for (const a of answers) {
      if (FORM_ITEMS.has(a.itemKey)) continue;
      (extra[a.sectionKey] ??= {})[a.itemKey] = a.record;
    }
    setScanned({ extra, count: Object.values(extra).reduce((n, s) => n + Object.keys(s).length, 0), photo: current.photo });
  }

  const update = (key: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const regNo = form.regNo.replace(/\s+/g, '').toUpperCase();

  function start() {
    const odometerKm = Number(form.odometer);
    const year = form.year ? Number(form.year) : undefined;
    const next: Errors = {};
    if (!regNo) next.regNo = 'Enter the registration number.';
    if (!form.make.trim()) next.make = 'Enter the make.';
    if (!form.model.trim()) next.model = 'Enter the model.';
    if (year !== undefined && (!Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() + 1)) {
      next.year = 'Enter a valid year, or leave it blank.';
    }
    if (!form.odometer || !Number.isFinite(odometerKm) || odometerKm < 0) next.odometer = 'Enter the reading in km.';
    if (!fuel) next.fuel = 'Choose the fuel type.';
    if (!transmission) next.transmission = 'Choose the transmission.';
    setErrors(next);
    if (Object.keys(next).length || !user || !fuel || !transmission) return;

    const id = createInspection(
      user.uid,
      {
        regNo,
        make: form.make.trim(),
        model: form.model.trim(),
        variant: form.variant.trim() || undefined,
        year,
        fuel,
        transmission,
        odometerKm,
      },
      scanned?.extra,
    );
    if (scanned) {
      const { photo } = scanned;
      const { evidenceId, storagePath } = addPhotoEvidence(user.uid, id, 'documents', 'rc', { width: photo.width, height: photo.height });
      enqueuePhoto({ evidenceId, inspectionId: id, storagePath }, photo.uri).catch((e) => console.warn('[new] RC photo failed', e));
    }
    router.replace(`/inspection/${id}`);
  }

  return (
    <Screen footer={<Button title="Start inspection" icon="forward" size="lg" onPress={start} />}>
      {scanned ? (
        <Banner tone="success" icon="documents" title="Filled in from the RC">
          {`Check the details below. ${scanned.count} more answer${scanned.count === 1 ? '' : 's'} from the RC will be saved with the inspection, and the RC photo filed as evidence.`}
        </Banner>
      ) : (
        <Card onPress={() => scan.start('rc')}>
          <View style={styles.scanRow}>
            <Icon name="camera" size={22} tone="primary" />
            <View style={styles.half}>
              <Text variant="bodyStrong">Scan the RC</Text>
              <Text variant="caption" tone="textMuted">
                Photograph the registration certificate to fill this in.
              </Text>
            </View>
            <Icon name="chevron" size={20} tone="textSubtle" />
          </View>
        </Card>
      )}
      <ScanSheet
        state={scan.state}
        current={{}}
        onApply={applyScan}
        onRetake={scan.retake}
        onClose={scan.close}
      />
      <Card>
        <Text variant="label" tone="textMuted">
          Registration
        </Text>
        <TextField
          large
          value={form.regNo}
          onChangeText={update('regNo')}
          placeholder="KA01AB1234"
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          error={errors.regNo}
        />
        {regNo.length >= 4 && <RegPlate regNo={regNo} size="lg" />}
      </Card>

      <Card>
        <Text variant="label" tone="textMuted">
          Vehicle
        </Text>
        <TextField label="Make" value={form.make} onChangeText={update('make')} placeholder="Maruti Suzuki" error={errors.make} />
        <View style={styles.chips}>
          {POPULAR_MAKES.map((m) => (
            <Chip key={m} label={m} selected={form.make === m} onPress={() => update('make')(m)} />
          ))}
        </View>
        <View style={styles.pair}>
          <View style={styles.half}>
            <TextField label="Model" value={form.model} onChangeText={update('model')} placeholder="Swift" error={errors.model} />
          </View>
          <View style={styles.half}>
            <TextField label="Variant (optional)" value={form.variant} onChangeText={update('variant')} placeholder="VXi" />
          </View>
        </View>
        <View style={styles.pair}>
          <View style={styles.half}>
            <TextField
              label="Year (optional)"
              value={form.year}
              onChangeText={update('year')}
              placeholder="2019"
              keyboardType="number-pad"
              maxLength={4}
              error={errors.year}
            />
          </View>
          <View style={styles.half}>
            <TextField
              label="Odometer"
              value={form.odometer}
              onChangeText={update('odometer')}
              placeholder="42000"
              keyboardType="number-pad"
              suffix="km"
              error={errors.odometer}
            />
          </View>
        </View>
      </Card>

      <Card>
        <Text variant="label" tone="textMuted">
          Fuel
        </Text>
        <View style={styles.chips}>
          {FUELS.map((f) => (
            <Chip key={f} large label={f} selected={fuel === f} onPress={() => setFuel(f)} />
          ))}
        </View>
        {errors.fuel && !fuel && (
          <Text variant="caption" tone="danger">
            {errors.fuel}
          </Text>
        )}
        <Text variant="label" tone="textMuted" style={styles.gapTop}>
          Transmission
        </Text>
        <View style={styles.chips}>
          {TRANSMISSIONS.map((t) => (
            <Chip key={t} large label={t} selected={transmission === t} onPress={() => setTransmission(t)} />
          ))}
        </View>
        {errors.transmission && !transmission && (
          <Text variant="caption" tone="danger">
            {errors.transmission}
          </Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  gapTop: { marginTop: space.sm },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
