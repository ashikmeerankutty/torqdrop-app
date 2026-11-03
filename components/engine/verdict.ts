import { STATUS_COLOR } from '@/components/inspection/status';
import type { IconName } from '@/components/ui/Icon';
import type { DriveAdvice } from '@/lib/schemas/diagnosis';
import type { HeardSound } from '@/lib/schemas/engine-sound';

type FindingSeverity = HeardSound['severity'];

/** Wording for an engine sound check's drive advice. Never says the car is safe. */
export const SOUND_VERDICT: Record<DriveAdvice, { title: string; body: string; color: string; icon: IconName }> = {
  ok: {
    title: 'Nothing worrying heard',
    body: 'The engine sounded normal in this clip. Keep up regular servicing.',
    color: STATUS_COLOR.good,
    icon: 'check',
  },
  caution: {
    title: 'Get it checked soon',
    body: 'Drive gently and avoid long trips until a mechanic has listened to it.',
    color: STATUS_COLOR.attention,
    icon: 'warning',
  },
  stop: {
    title: 'Stop driving',
    body: 'What was heard could mean serious damage. Have it checked before you drive again.',
    color: STATUS_COLOR.defect,
    icon: 'error',
  },
};

export const SEVERITY_COLOR: Record<FindingSeverity, string> = {
  info: '#757575',
  monitor: STATUS_COLOR.acceptable,
  attention: STATUS_COLOR.attention,
  urgent: STATUS_COLOR.defect,
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  info: 'Normal',
  monitor: 'Keep an eye on it',
  attention: 'Get it checked',
  urgent: 'Urgent',
};

/** "0:07" */
export const clipTime = (s: number) => `0:${String(Math.round(s)).padStart(2, '0')}`;
