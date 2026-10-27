import { KeySymbol } from '../../utils/key-symbol';
import { isIOS, isMacOS } from '../../utils/user-agent';

// is-hotkey reads `mod+k` as Command on Apple platforms, iPhone and iPad included.
const usesCommandKey = (): boolean => isMacOS() || isIOS();

export const getCommandPaletteShortcutLabel = (): string =>
  usesCommandKey() ? `${KeySymbol.Command} K` : 'Ctrl + K';

export const getCommandPaletteAriaKeyShortcuts = (): string =>
  usesCommandKey() ? 'Meta+K' : 'Control+K';
