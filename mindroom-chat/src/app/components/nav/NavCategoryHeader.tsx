import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { as } from 'folds';
import { Header } from '../glass/GlassPrimitives';
import * as css from './styles.css';

export type NavCategoryHeaderProps = {
  children: ReactNode;
};
export const NavCategoryHeader = as<'div', NavCategoryHeaderProps>(
  ({ className, ...props }, ref) => (
    <Header
      appearance="plain"
      className={classNames(css.NavCategoryHeader, className)}
      variant="Background"
      size="300"
      {...props}
      ref={ref}
    />
  )
);
