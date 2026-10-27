import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { particleBackgroundColorVar } from '../particle-background/particleBackgroundTheme.css';

export const SplashScreen = style({
  minHeight: '100%',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
});

export const SplashScreenParticle = style({
  backgroundColor: particleBackgroundColorVar,
  pointerEvents: 'none',
});

globalStyle(
  `${SplashScreenParticle} :is(a, button, input, label, select, textarea, [role='button'], [role='menuitem'], [tabindex]:not([tabindex='-1']))`,
  {
    pointerEvents: 'auto',
  }
);

export const SplashScreenPersistentParticle = style({
  zIndex: 1,
  backgroundColor: 'transparent',
});

export const SplashScreenContent = style({
  position: 'relative',
  zIndex: 1,
});

export const SplashScreenFooter = style({
  position: 'relative',
  zIndex: 1,
  padding: config.space.S400,
  paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
});
