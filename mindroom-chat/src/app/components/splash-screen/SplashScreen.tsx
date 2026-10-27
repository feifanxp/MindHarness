import { Box, Text } from 'folds';
import React, { ReactNode } from 'react';
import classNames from 'classnames';
import * as css from './SplashScreen.css';
import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
import { ParticleBackgroundSurface, usePersistentParticleBackground } from '../particle-background';

type SplashScreenProps = {
  children: ReactNode;
  background?: ReactNode;
};

export function SplashScreen({ children, background }: SplashScreenProps) {
  const hasPersistentParticleBackground = usePersistentParticleBackground();
  const resolvedBackground = background || <ParticleBackgroundSurface position="fixed" />;
  const usesPersistentParticleBackground = !background && hasPersistentParticleBackground;

  return (
    <Box
      className={classNames(
        css.SplashScreen,
        resolvedBackground && css.SplashScreenParticle,
        usesPersistentParticleBackground && css.SplashScreenPersistentParticle
      )}
      direction="Column"
    >
      {resolvedBackground}
      {resolvedBackground ? (
        <Box className={css.SplashScreenContent} direction="Column" grow="Yes">
          {children}
        </Box>
      ) : (
        children
      )}
      <Box
        className={css.SplashScreenFooter}
        shrink="No"
        alignItems="Center"
        justifyContent="Center"
      >
        <Text size="H2" align="Center">
          {MINDROOM_CLIENT_BRANDING.appName}
        </Text>
      </Box>
    </Box>
  );
}
