import type { ImageSourcePropType } from 'react-native';

/**
 * Real example photos for the check guides, keyed by checklist item key. Empty until photos are
 * supplied; the guide shows the car diagram meanwhile.
 *
 * To add one: put the image in assets/guides/ (e.g. assets/guides/apron_rhs-good.jpg, about 1200 px
 * wide), then add it here with a caption:
 *
 *   apron_rhs: [{ source: require('@/assets/guides/apron_rhs-good.jpg'), caption: 'Factory apron: even sealant, no welds' }],
 *
 * Use photos you have the rights to, with number plates and people removed.
 */
export const GUIDE_SAMPLES: Partial<Record<string, { source: ImageSourcePropType; caption: string }[]>> = {};
