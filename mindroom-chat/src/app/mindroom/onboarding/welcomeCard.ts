import { CSSProperties } from 'react';

/**
 * Bordered card used by the WelcomePage first-run column (setup instructions,
 * key-backup nudge) so the stacked cards stay visually identical. A plain
 * style object rather than vanilla-extract because the consuming components
 * are covered by vitest, which does not run the vanilla-extract plugin.
 */
export const WelcomeCardStyle: CSSProperties = {
  border: '1px solid rgba(125, 125, 125, 0.28)',
  borderRadius: '8px',
  padding: '12px',
  textAlign: 'left',
};
