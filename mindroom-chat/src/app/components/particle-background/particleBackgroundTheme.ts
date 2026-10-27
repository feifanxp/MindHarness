export type ParticleThemeKind = 'dark' | 'light';

export type ParticleTheme = {
  backgroundColor: string;
  particleColor: string;
  backgroundRadialGradient: string;
  cardBackground: string;
  cardText: string;
  cardHighlight: string;
  cardBorder: string;
};

export const DARK_PARTICLE_THEME: ParticleTheme = {
  backgroundColor: '#0f0d2e',
  particleColor: '#dda290',
  backgroundRadialGradient:
    'radial-gradient(circle at 50% 45%, rgba(221, 162, 144, 0.18), rgba(15, 13, 46, 0.12) 30%, rgba(15, 13, 46, 1) 72%)',
  cardBackground: 'rgba(18, 16, 42, 0.22)',
  cardText: '#f8f5ff',
  cardHighlight: 'rgba(255, 255, 255, 0.16)',
  cardBorder: 'rgba(255, 255, 255, 0.22)',
};

// Light mode inverts the dark palette: golden backdrop, purple particles.
export const LIGHT_PARTICLE_THEME: ParticleTheme = {
  backgroundColor: '#f6e8d6',
  particleColor: '#5636a3',
  backgroundRadialGradient:
    'radial-gradient(circle at 50% 45%, rgba(86, 54, 163, 0.16), rgba(246, 232, 214, 0.12) 30%, rgba(246, 232, 214, 1) 72%)',
  cardBackground: 'rgba(255, 252, 245, 0.5)',
  cardText: '#241b45',
  cardHighlight: 'rgba(255, 255, 255, 0.6)',
  cardBorder: 'rgba(36, 27, 69, 0.16)',
};

export const PARTICLE_THEMES: Record<ParticleThemeKind, ParticleTheme> = {
  dark: DARK_PARTICLE_THEME,
  light: LIGHT_PARTICLE_THEME,
};
