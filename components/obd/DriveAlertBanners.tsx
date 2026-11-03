import { Banner } from '@/components/ui/Banner';
import { useDriveAlerts } from '@/lib/obd/alerts';

/** Live driving alerts (overheating, low charging, speed, redline, check-engine light). */
export function DriveAlertBanners() {
  const alerts = useDriveAlerts();
  return (
    <>
      {alerts.map((a) => (
        <Banner key={a.id} solid tone={a.severity === 'danger' ? 'danger' : 'warning'} title={a.title}>
          {a.body}
        </Banner>
      ))}
    </>
  );
}
