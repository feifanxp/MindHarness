import { createTheme } from '@vanilla-extract/css';
import { color } from 'folds';

/**
 * All five palettes are generated from one OKLCH ramp so they read as a family:
 *
 * - Single brand hue (288deg, indigo-violet) across every theme. Previously
 *   light/silver used a blue Primary and the dark family a lavender one.
 * - Neutrals carry a trace of the brand hue (chroma 0.005-0.022) so greys look
 *   chosen rather than dead. Butter tints warm (95deg) instead.
 * - `ContainerLine` sits ~0.03 lightness from its own `Container`, not ~0.13.
 *   Borders read as edges instead of hard rules.
 * - `Other.Shadow` is translucent everywhere. The dark family previously used
 *   opaque black, which defeated the diffuse `softShadow` tokens.
 *
 * Every `Background.Container` value is deliberately unchanged, because those
 * five hexes are duplicated in `src/index.css`, `src/app/theme/themeBootstrap.ts`
 * and the pre-paint bootstrap in `index.html`.
 *
 * Contrast: every text-on-container pair clears WCAG AA 4.5:1, except
 * `Success.Main`/`Warning.Main` on light-kind backgrounds, which are icon and
 * badge colors held to the 3:1 non-text threshold.
 */

const lightNeutralOn = '#1F1E26';
const darkNeutralOn = '#ECECEF';
const butterNeutralOn = '#FBF6DC';

export const lightTheme = createTheme(color, {
  Background: {
    Container: '#F2F2F2',
    ContainerHover: '#E7E7EB',
    ContainerActive: '#DDDDE2',
    ContainerLine: '#E1E1E6',
    OnContainer: lightNeutralOn,
  },

  Surface: {
    Container: '#FFFFFF',
    ContainerHover: '#F6F6FB',
    ContainerActive: '#EEEEF3',
    ContainerLine: '#EAEAEE',
    OnContainer: lightNeutralOn,
  },

  SurfaceVariant: {
    Container: '#F4F4F8',
    ContainerHover: '#ECECF0',
    ContainerActive: '#E4E4E8',
    ContainerLine: '#DFDFE4',
    OnContainer: lightNeutralOn,
  },

  Primary: {
    Main: '#694CCD',
    MainHover: '#5E3FC0',
    MainActive: '#5637B3',
    MainLine: '#5132AA',
    OnMain: '#FFFFFF',
    Container: '#EFEEFF',
    ContainerHover: '#E4E3FF',
    ContainerActive: '#DAD8FD',
    ContainerLine: '#D7D4FC',
    OnContainer: '#462C93',
  },

  Secondary: {
    Main: lightNeutralOn,
    MainHover: '#2D2D34',
    MainActive: '#3A3A40',
    MainLine: '#47474D',
    OnMain: '#FFFFFF',
    Container: '#DDDDE2',
    ContainerHover: '#D4D4D8',
    ContainerActive: '#CACACE',
    ContainerLine: '#C4C3C8',
    OnContainer: '#16151B',
  },

  Success: {
    Main: '#00823C',
    MainHover: '#007631',
    MainActive: '#006C2A',
    MainLine: '#006626',
    OnMain: '#FFFFFF',
    Container: '#E2F6E8',
    ContainerHover: '#D2EFDB',
    ContainerActive: '#C3E7CE',
    ContainerLine: '#BDE4CA',
    OnContainer: '#005822',
  },

  Warning: {
    Main: '#AA5B00',
    MainHover: '#9D4F00',
    MainActive: '#924700',
    MainLine: '#8A4200',
    OnMain: '#FFFFFF',
    Container: '#FDEDDC',
    ContainerHover: '#F8E2CA',
    ContainerActive: '#F2D7B9',
    ContainerLine: '#F1D4B2',
    OnContainer: '#783B00',
  },

  Critical: {
    Main: '#AC3031',
    MainHover: '#9E2225',
    MainActive: '#921A1F',
    MainLine: '#8A161B',
    OnMain: '#FFFFFF',
    Container: '#FFE9E7',
    ContainerHover: '#FFDDD9',
    ContainerActive: '#FCD0CC',
    ContainerLine: '#FCCCC7',
    OnContainer: '#761619',
  },

  Other: {
    FocusRing: 'rgba(31, 30, 38, 0.45)',
    Shadow: 'rgba(31, 30, 38, 0.13)',
    Overlay: 'rgba(31, 30, 38, 0.45)',
  },
});

// Silver sits on a darker background than light, so its accents step down one
// lightness notch to hold 4.5:1 against `Background.Container`.
export const silverTheme = createTheme(color, {
  Background: {
    Container: '#DEDEDE',
    ContainerHover: '#D0D0D4',
    ContainerActive: '#C7C7CC',
    ContainerLine: '#CCCBD0',
    OnContainer: lightNeutralOn,
  },

  Surface: {
    Container: '#F0EFF4',
    ContainerHover: '#E7E7EB',
    ContainerActive: '#DEDEE2',
    ContainerLine: '#E2E2E7',
    OnContainer: lightNeutralOn,
  },

  SurfaceVariant: {
    Container: '#E1E1E6',
    ContainerHover: '#D9D9DD',
    ContainerActive: '#D0D0D5',
    ContainerLine: '#D5D5D9',
    OnContainer: lightNeutralOn,
  },

  Primary: {
    Main: '#5F43BF',
    MainHover: '#5535B2',
    MainActive: '#4D2DA5',
    MainLine: '#48289C',
    OnMain: '#FFFFFF',
    Container: '#EFEEFF',
    ContainerHover: '#E4E3FF',
    ContainerActive: '#DAD8FD',
    ContainerLine: '#D7D4FC',
    OnContainer: '#3D2286',
  },

  Secondary: {
    Main: lightNeutralOn,
    MainHover: '#2D2D34',
    MainActive: '#3A3A40',
    MainLine: '#47474D',
    OnMain: '#F0EFF4',
    Container: '#D4D4D8',
    ContainerHover: '#CACACE',
    ContainerActive: '#C4C3C8',
    ContainerLine: '#BBBABF',
    OnContainer: '#16151B',
  },

  Success: {
    Main: '#007934',
    MainHover: '#006D28',
    MainActive: '#006321',
    MainLine: '#005D1E',
    OnMain: '#FFFFFF',
    Container: '#E2F6E8',
    ContainerHover: '#D2EFDB',
    ContainerActive: '#C3E7CE',
    ContainerLine: '#BDE4CA',
    OnContainer: '#004F1A',
  },

  Warning: {
    Main: '#A15200',
    MainHover: '#944600',
    MainActive: '#893E00',
    MainLine: '#813900',
    OnMain: '#FFFFFF',
    Container: '#FDEDDC',
    ContainerHover: '#F8E2CA',
    ContainerActive: '#F2D7B9',
    ContainerLine: '#F1D4B2',
    OnContainer: '#6F3300',
  },

  Critical: {
    Main: '#A3282A',
    MainHover: '#96181E',
    MainActive: '#8A0E18',
    MainLine: '#810914',
    OnMain: '#FFFFFF',
    Container: '#FFE9E7',
    ContainerHover: '#FFDDD9',
    ContainerActive: '#FCD0CC',
    ContainerLine: '#FCCCC7',
    OnContainer: '#6D0B12',
  },

  Other: {
    FocusRing: 'rgba(31, 30, 38, 0.45)',
    Shadow: 'rgba(31, 30, 38, 0.16)',
    Overlay: 'rgba(31, 30, 38, 0.45)',
  },
});

// Accents are identical across the three dark-kind themes; only the neutral
// ladders and `Secondary` differ.
const darkAccents = {
  Primary: {
    Main: '#B3A9FF',
    MainHover: '#BEB5FF',
    MainActive: '#C6BEFF',
    MainLine: '#A49AF4',
    OnMain: '#1E1B35',
    Container: '#36315C',
    ContainerHover: '#423C6C',
    ContainerActive: '#4E477C',
    ContainerLine: '#494276',
    OnContainer: '#E1DFFD',
  },

  Success: {
    Main: '#81D39F',
    MainHover: '#8CDEAA',
    MainActive: '#9BE5B4',
    MainLine: '#71C38F',
    OnMain: '#072614',
    Container: '#0D4326',
    ContainerHover: '#175030',
    ContainerActive: '#215D3B',
    ContainerLine: '#1A5835',
    OnContainer: '#CFEBD8',
  },

  Warning: {
    Main: '#EEB97B',
    MainHover: '#FAC486',
    MainActive: '#FECE96',
    MainLine: '#DDA96B',
    OnMain: '#2E1A01',
    Container: '#503000',
    ContainerHover: '#5E3B05',
    ContainerActive: '#6D4610',
    ContainerLine: '#674107',
    OnContainer: '#F5DFC7',
  },

  Critical: {
    Main: '#EC928B',
    MainHover: '#F89D95',
    MainActive: '#FBA8A0',
    MainLine: '#DA827B',
    OnMain: '#331513',
    Container: '#592624',
    ContainerHover: '#68312D',
    ContainerActive: '#783B38',
    ContainerLine: '#723632',
    OnContainer: '#FDD9D6',
  },

  Other: {
    FocusRing: 'rgba(236, 236, 239, 0.45)',
    Shadow: 'rgba(0, 0, 0, 0.55)',
    Overlay: 'rgba(10, 10, 12, 0.7)',
  },
};

export const darkTheme = createTheme(color, {
  ...darkAccents,

  Background: {
    Container: '#1A1A1A',
    ContainerHover: '#2B2B2E',
    ContainerActive: '#363639',
    ContainerLine: '#2F2F31',
    OnContainer: darkNeutralOn,
  },

  Surface: {
    Container: '#2B2B2E',
    ContainerHover: '#363639',
    ContainerActive: '#424144',
    ContainerLine: '#3A3A3D',
    OnContainer: darkNeutralOn,
  },

  SurfaceVariant: {
    Container: '#363639',
    ContainerHover: '#424144',
    ContainerActive: '#4D4D50',
    ContainerLine: '#464649',
    OnContainer: darkNeutralOn,
  },

  Secondary: {
    Main: darkNeutralOn,
    MainHover: '#D7D7DA',
    MainActive: '#C4C4C7',
    MainLine: '#B1B1B3',
    OnMain: '#1A1A1A',
    Container: '#363639',
    ContainerHover: '#424144',
    ContainerActive: '#4D4D50',
    ContainerLine: '#47474A',
    OnContainer: darkNeutralOn,
  },
});

// Midnight is the dark ladder with the brand hue pushed to a visible tint
// (chroma 0.022 instead of 0.005).
export const midnightTheme = createTheme(color, {
  ...darkAccents,

  Background: {
    Container: '#17161D',
    ContainerHover: '#2B2A36',
    ContainerActive: '#363542',
    ContainerLine: '#2E2D3A',
    OnContainer: darkNeutralOn,
  },

  Surface: {
    Container: '#2B2A36',
    ContainerHover: '#363542',
    ContainerActive: '#41404D',
    ContainerLine: '#3A3946',
    OnContainer: darkNeutralOn,
  },

  SurfaceVariant: {
    Container: '#363542',
    ContainerHover: '#41404D',
    ContainerActive: '#4C4B59',
    ContainerLine: '#454552',
    OnContainer: darkNeutralOn,
  },

  Secondary: {
    Main: darkNeutralOn,
    MainHover: '#D7D7DA',
    MainActive: '#C4C4C7',
    MainLine: '#B1B1B3',
    OnMain: '#17161D',
    Container: '#363542',
    ContainerHover: '#41404D',
    ContainerActive: '#4C4B59',
    ContainerLine: '#454552',
    OnContainer: darkNeutralOn,
  },
});

// Butter is the dark ladder tinted warm (95deg) with a cream `OnContainer`.
export const butterTheme = createTheme(color, {
  ...darkAccents,

  Background: {
    Container: '#1A1916',
    ContainerHover: '#2D2B24',
    ContainerActive: '#39372F',
    ContainerLine: '#312F27',
    OnContainer: butterNeutralOn,
  },

  Surface: {
    Container: '#2D2B24',
    ContainerHover: '#39372F',
    ContainerActive: '#44423A',
    ContainerLine: '#3D3B32',
    OnContainer: butterNeutralOn,
  },

  SurfaceVariant: {
    Container: '#39372F',
    ContainerHover: '#44423A',
    ContainerActive: '#4F4D45',
    ContainerLine: '#49463E',
    OnContainer: butterNeutralOn,
  },

  Secondary: {
    Main: butterNeutralOn,
    MainHover: '#E6E1C8',
    MainActive: '#D2CDB6',
    MainLine: '#BEB9A3',
    OnMain: '#1A1916',
    Container: '#39372F',
    ContainerHover: '#44423A',
    ContainerActive: '#4F4D45',
    ContainerLine: '#49463E',
    OnContainer: butterNeutralOn,
  },

  Other: {
    FocusRing: 'rgba(251, 246, 220, 0.45)',
    Shadow: 'rgba(0, 0, 0, 0.55)',
    Overlay: 'rgba(12, 11, 8, 0.7)',
  },
});
