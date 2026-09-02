export { escapeHTML, fileName, stripExtension } from './utils/strings.js';
export { detectLineEnding } from './utils/line-ending.js';
export { ALL_THEMES, DARK_THEMES, isDarkTheme, LIGHT_THEMES, THEME_MODES } from './ui/theme.js';
export {
  formatIpcErrorMessage,
  IPC_ERROR_MESSAGE_KEYS,
  resolveLocale,
  translate,
} from './ui/localization.js';
export {
  getPreferredCodeTheme,
  resolveContentTheme,
  resolveEffectiveTheme,
  resolveThemeMode,
  validateDarkTheme,
  validateLightTheme,
} from './ui/theme-controller.js';
