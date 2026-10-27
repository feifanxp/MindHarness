import React, { ReactNode } from 'react';
import { Box, as } from 'folds';
import * as css from './layout.css';
import { MESSAGE_LAYOUT_GAP } from './config';

type ModernLayoutProps = {
  before?: ReactNode;
};

export const ModernLayout = as<'div', ModernLayoutProps>(({ before, children, ...props }, ref) => (
  <Box gap={MESSAGE_LAYOUT_GAP} {...props} ref={ref}>
    <Box className={css.ModernBefore} shrink="No">
      {before}
    </Box>
    <Box grow="Yes" direction="Column">
      {children}
    </Box>
  </Box>
));
