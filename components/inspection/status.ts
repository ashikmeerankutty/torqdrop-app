import type { IconName } from '@/components/ui/Icon';
import type { ItemStatus, SectionStatus } from '@/lib/diagnostics/checklists/types';
import type { Verdict } from '@/lib/diagnostics/evidence-engine';
import type { InspectionStatus } from '@/lib/firebase/inspections';

/** Mid-tone colours that read on both light and dark backgrounds, with white text. */
export const STATUS_COLOR: Record<ItemStatus, string> = {
  good: '#2e7d32',
  acceptable: '#558b2f',
  attention: '#ef6c00',
  defect: '#c62828',
  not_applicable: '#757575',
  not_inspected: '#8d6e63',
};

export const SECTION_STATUS: Record<SectionStatus, { label: string; color: string }> = {
  not_started: { label: 'Not started', color: '#757575' },
  complete: { label: 'Complete', color: STATUS_COLOR.good },
  needs_investigation: { label: 'Needs attention', color: STATUS_COLOR.attention },
  not_inspected: { label: 'Not inspected', color: STATUS_COLOR.not_inspected },
};

export const INSPECTION_STATUS: Record<InspectionStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#757575' },
  in_progress: { label: 'In progress', color: '#1E6FD9' },
  blocked: { label: 'Blocked', color: STATUS_COLOR.attention },
  complete: { label: 'Complete', color: STATUS_COLOR.good },
};

export const SECTION_ICON: Record<string, IconName> = {
  vehicle_details: 'car',
  documents: 'documents',
  engine: 'engine',
  transmission: 'transmission',
  suspension: 'suspension',
  steering: 'steering',
  brakes: 'brakes',
  electricals: 'electricals',
  body_panels: 'body',
  structure: 'structure',
  glass: 'glass',
  tyres: 'tyres',
  interior: 'interior',
  flood: 'flood',
};

/** Headline for the review and report. Never claims the car is fine: unchecked is unknown. */
export const VERDICT: Record<Verdict, { title: string; body: string; color: string; icon: IconName }> = {
  no_major_issues: {
    title: 'No major issues found',
    body: 'Nothing was rated as needing attention. Checks that were not inspected are unknowns.',
    color: STATUS_COLOR.good,
    icon: 'check',
  },
  issues_found: {
    title: 'Issues found',
    body: 'Some checks need attention. None are defects in critical areas.',
    color: STATUS_COLOR.attention,
    icon: 'warning',
  },
  serious_issues: {
    title: 'Serious issues found',
    body: 'There are defects in critical areas or urgent findings. Review them before buying.',
    color: STATUS_COLOR.defect,
    icon: 'error',
  },
};
