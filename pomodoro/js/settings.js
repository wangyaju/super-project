/** 应用设置：默认值、取值范围与归一化。 */

export const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  sound: true,
  notifications: true,
  theme: 'system',
});

export const LIMITS = Object.freeze({
  focusMinutes: { min: 1, max: 120 },
  shortBreakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 120 },
  longBreakInterval: { min: 2, max: 12 },
});

export const THEMES = ['system', 'light', 'dark', 'sakura', 'forest', 'ocean'];

/** 主题的展示名称，设置界面与顶栏主题菜单共用。 */
export const THEME_LABELS = Object.freeze({
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
  sakura: '樱花',
  forest: '森林',
  ocean: '海洋',
});

/** 将任意值截取为合法整数，非法值返回 fallback。 */
export function clampInteger(value, min, max, fallback) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return fallback;
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    focusMinutes: clampInteger(
      source.focusMinutes,
      LIMITS.focusMinutes.min,
      LIMITS.focusMinutes.max,
      DEFAULT_SETTINGS.focusMinutes,
    ),
    shortBreakMinutes: clampInteger(
      source.shortBreakMinutes,
      LIMITS.shortBreakMinutes.min,
      LIMITS.shortBreakMinutes.max,
      DEFAULT_SETTINGS.shortBreakMinutes,
    ),
    longBreakMinutes: clampInteger(
      source.longBreakMinutes,
      LIMITS.longBreakMinutes.min,
      LIMITS.longBreakMinutes.max,
      DEFAULT_SETTINGS.longBreakMinutes,
    ),
    longBreakInterval: clampInteger(
      source.longBreakInterval,
      LIMITS.longBreakInterval.min,
      LIMITS.longBreakInterval.max,
      DEFAULT_SETTINGS.longBreakInterval,
    ),
    autoStartBreaks: Boolean(source.autoStartBreaks),
    autoStartFocus: Boolean(source.autoStartFocus),
    sound: source.sound === undefined ? DEFAULT_SETTINGS.sound : Boolean(source.sound),
    notifications:
      source.notifications === undefined
        ? DEFAULT_SETTINGS.notifications
        : Boolean(source.notifications),
    theme: THEMES.includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
  };
}
