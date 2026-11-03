import { StyleSheet, View as RNView } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { radius, space } from '@/constants/Theme';
import type { Finding } from '@/lib/firebase/inspections';

import { STATUS_COLOR } from './status';

const SEVERITY: Record<Finding['severity'], { label: string; color: string }> = {
  info: { label: 'Note', color: STATUS_COLOR.not_applicable },
  monitor: { label: 'Monitor', color: STATUS_COLOR.acceptable },
  attention: { label: 'Attention', color: STATUS_COLOR.attention },
  urgent: { label: 'Urgent', color: STATUS_COLOR.defect },
};

const VERIFICATION: Record<Finding['verificationStatus'], string> = {
  ai_suggested: 'AI suggestion · not verified',
  awaiting_verification: 'Awaiting verification',
  confirmed: 'Confirmed by inspector',
  dismissed: 'Dismissed by inspector',
};

/** An AI finding stays visibly separate from the inspector's own answer until it is confirmed. */
export function FindingCard({ finding, onVerify }: { finding: Finding; onVerify: (status: 'confirmed' | 'dismissed') => void }) {
  const { colors } = useTheme();
  const sev = SEVERITY[finding.severity];
  const dismissed = finding.verificationStatus === 'dismissed';
  const confirmed = finding.verificationStatus === 'confirmed';
  return (
    <RNView
      style={[
        styles.card,
        { backgroundColor: colors.surfaceRaised, borderLeftColor: sev.color, opacity: dismissed ? 0.5 : 1 },
      ]}>
      <RNView style={styles.header}>
        <Icon name={confirmed ? 'check' : 'ai'} size={16} color={confirmed ? STATUS_COLOR.good : colors.primary} />
        <Text variant="caption" tone="textMuted" style={styles.grow}>
          {VERIFICATION[finding.verificationStatus]}
          {finding.confidence ? ` · ${finding.confidence} confidence` : ''}
        </Text>
        <Pill label={sev.label} color={sev.color} />
      </RNView>
      <Text variant="bodyStrong">{finding.observedCondition}</Text>
      {!!finding.aiInterpretation && <Text variant="caption">{finding.aiInterpretation}</Text>}
      {!!finding.uncertainty && (
        <Text variant="caption" tone="textMuted">
          Uncertainty: {finding.uncertainty}
        </Text>
      )}
      {!!finding.missingEvidence?.length && (
        <Text variant="caption" tone="textMuted">
          To confirm: {finding.missingEvidence.join('; ')}
        </Text>
      )}
      {!!finding.nextAction && <Text variant="caption">Next: {finding.nextAction}</Text>}
      {finding.verificationStatus === 'ai_suggested' && (
        <RNView style={styles.actions}>
          <Button title="Confirm" icon="check" variant="secondary" onPress={() => onVerify('confirmed')} style={styles.action} />
          <Button title="Dismiss" icon="close" variant="ghost" onPress={() => onVerify('dismissed')} style={styles.action} />
        </RNView>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  card: { borderLeftWidth: 4, borderRadius: radius.md, padding: space.md, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  action: { flex: 1, minHeight: 40, paddingVertical: space.sm },
});
