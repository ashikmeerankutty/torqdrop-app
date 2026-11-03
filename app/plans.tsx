import { Linking, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { FREE_REPORTS, REPORT_PACKS, reportsLeft, rupees } from '@/lib/billing/plans';
import { useReportStore } from '@/lib/billing/use-report-store';
import { useCredits } from '@/lib/firebase/billing';
import { SUPPORT_EMAIL } from '@/lib/links';

/** Report balance and Google Play report packs. A report is used when an inspection is signed off. */
export default function PlansScreen() {
  const { colors } = useTheme();
  const credits = useCredits();
  const store = useReportStore();
  const left = credits ? reportsLeft(credits) : null;
  const freeLeft = credits ? Math.max(0, FREE_REPORTS - credits.freeUsed) : 0;

  return (
    <Screen>
      {store.notice && (
        <Banner tone={store.notice.tone} title={store.notice.tone === 'success' ? 'Thank you' : undefined}>
          {store.notice.text}
        </Banner>
      )}

      <Card>
        <Text variant="label" tone="textMuted">
          Your reports
        </Text>
        <Text variant="metric">{left ?? '–'}</Text>
        <Text variant="caption" tone="textMuted">
          {freeLeft > 0
            ? `Includes your ${freeLeft === 1 ? 'free report' : `${freeLeft} free reports`}. `
            : ''}
          A report is used when you sign off an inspection. Reports never expire.
        </Text>
      </Card>

      {!store.connected ? (
        <Banner tone="info" title="Connecting to Google Play">
          {'If this takes long, check your connection. Report packs can only be bought in the app installed from Google Play.'}
        </Banner>
      ) : (
        !store.loaded && (
          <Banner tone="info" title="Report packs unavailable">
            {"Google Play didn't return the report packs. Make sure TorqDrop was installed from Google Play, then try again."}
          </Banner>
        )
      )}

      {REPORT_PACKS.map((p) => {
        const play = store.priceOf(p.id);
        const amount = play?.amount ?? p.price;
        const busy = store.buying === p.id;
        return (
          <Card key={p.id} highlighted={p.highlighted}>
            <View style={styles.rowBetween}>
              <Text variant="heading">{p.name}</Text>
              {p.highlighted && <Pill label="Best value" color={colors.primary} />}
            </View>
            <Text variant="caption" tone="textMuted">
              {p.tagline}
            </Text>
            <View style={styles.priceRow}>
              <Text variant="title">{play?.label ?? rupees(p.price)}</Text>
              {p.reports > 1 && (
                <Text variant="caption" tone="textMuted">
                  {rupees(Math.round(amount / p.reports))} per report
                </Text>
              )}
            </View>
            <Button
              title={busy ? 'Opening Google Play…' : `Buy ${p.reports === 1 ? '1 report' : `${p.reports} reports`}`}
              variant={p.highlighted ? 'primary' : 'secondary'}
              loading={busy}
              disabled={!store.loaded || (store.buying !== null && !busy)}
              onPress={() => store.buy(p.id)}
            />
          </Card>
        );
      })}

      <Card>
        <View style={styles.rowBetween}>
          <Text variant="heading">For shops and dealers</Text>
          <Pill label="Coming soon" color={colors.textMuted} />
        </View>
        <Text variant="caption" tone="textMuted">
          Monthly plans for garages, dealers and inspection businesses are on the way. Until then, the 20-report pack is
          the best price per report.
        </Text>
        <Button
          title="Ask about shop plans"
          variant="ghost"
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('TorqDrop shop plans')}`)}
        />
      </Card>

      <Text variant="caption" tone="textSubtle" style={styles.center}>
        Prices include GST. Payment is handled by Google Play, using UPI, cards or your Play balance. AI checks have
        fair-use limits.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  center: { textAlign: 'center' },
});
