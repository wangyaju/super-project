/**
 * 番茄钟核心状态机。
 *
 * 不依赖 DOM 或浏览器 API，便于单元测试。UI 通过 tick() 驱动：
 * 计时基于真实时间戳（endAt）而不是累加间隔，因此标签页被节流或
 * 系统休眠后恢复，剩余时间依然准确。
 */
export const MODES = ['focus', 'shortBreak', 'longBreak'];

export const MODE_LABELS = {
  focus: '专注',
  shortBreak: '短休息',
  longBreak: '长休息',
};

const MINUTE_MS = 60_000;

/** 某个模式的完整时长（毫秒）。 */
export function modeDurationMs(settings, mode) {
  const minutes =
    mode === 'focus'
      ? settings.focusMinutes
      : mode === 'shortBreak'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  const numeric = Number(minutes);
  const safeMinutes = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  return Math.round(safeMinutes * MINUTE_MS);
}

/** 将毫秒格式化为 mm:ss（向上取整到秒）。 */
export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function breakAfterFocus(settings, completedFocusSessions) {
  const interval = Math.max(1, Math.floor(settings.longBreakInterval));
  return completedFocusSessions > 0 && completedFocusSessions % interval === 0
    ? 'longBreak'
    : 'shortBreak';
}

export class PomodoroEngine {
  /**
   * @param {object} options
   * @param {object} options.settings 已归一化的设置
   * @param {number} [options.totalFocusSessions] 历史累计完成的专注数
   * @param {() => number} [options.now] 时钟，便于测试
   */
  constructor({ settings, totalFocusSessions = 0, now = () => Date.now() }) {
    this.settings = { ...settings };
    this.now = now;
    this.mode = 'focus';
    this.status = 'idle'; // idle | running | paused
    this.totalFocusSessions = Math.max(0, Math.floor(totalFocusSessions));
    this.totalMs = modeDurationMs(this.settings, this.mode);
    this.remainingMs = this.totalMs;
    this.endAt = null;
  }

  get isRunning() {
    return this.status === 'running';
  }

  /** 开始或继续计时。 */
  start(atMs = this.now()) {
    if (this.status === 'running') return false;
    if (this.remainingMs <= 0) this.remainingMs = this.totalMs;
    this.status = 'running';
    this.endAt = atMs + this.remainingMs;
    return true;
  }

  /** 暂停计时。 */
  pause(atMs = this.now()) {
    if (this.status !== 'running') return false;
    this.remainingMs = Math.max(0, this.endAt - atMs);
    this.status = 'paused';
    this.endAt = null;
    return true;
  }

  toggle(atMs = this.now()) {
    return this.status === 'running' ? this.pause(atMs) : this.start(atMs);
  }

  /** 重置当前模式到完整时长。 */
  reset() {
    this.status = 'idle';
    this.totalMs = modeDurationMs(this.settings, this.mode);
    this.remainingMs = this.totalMs;
    this.endAt = null;
  }

  /** 手动切换到指定模式，并重置计时。不做任何统计。 */
  select(mode) {
    if (!MODES.includes(mode)) return false;
    this.mode = mode;
    this.reset();
    return true;
  }

  /**
   * 跳过当前阶段：不记为完成的专注，进入下一阶段并保持暂停。
   * 跳过的专注不发长休息。
   */
  skip() {
    const from = this.mode;
    this.mode = from === 'focus' ? 'shortBreak' : 'focus';
    this.reset();
    return { from, to: this.mode };
  }

  /** 设置变更后调用；空闲时立即应用新时长。 */
  changeSettings(nextSettings) {
    const wasIdle = this.status === 'idle';
    this.settings = { ...nextSettings };
    if (wasIdle) {
      this.totalMs = modeDurationMs(this.settings, this.mode);
      this.remainingMs = this.totalMs;
    }
    return wasIdle;
  }

  /**
   * 推进时钟。若当前阶段结束则自动切换到下一阶段。
   * @returns {null | {from: string, to: string, focusMinutes: number,
   *   autoStarted: boolean, totalFocusSessions: number}}
   */
  tick(atMs = this.now()) {
    if (this.status !== 'running') return null;

    const left = this.endAt - atMs;
    if (left > 0) {
      this.remainingMs = left;
      return null;
    }

    const from = this.mode;
    const completedFocus = from === 'focus';
    let focusMinutes = 0;

    if (completedFocus) {
      this.totalFocusSessions += 1;
      focusMinutes = Math.round(this.totalMs / MINUTE_MS);
    }

    const to =
      from === 'focus'
        ? breakAfterFocus(this.settings, this.totalFocusSessions)
        : 'focus';

    this.mode = to;
    this.status = 'idle';
    this.totalMs = modeDurationMs(this.settings, to);
    this.remainingMs = this.totalMs;
    this.endAt = null;

    const autoStart = to === 'focus' ? this.settings.autoStartFocus : this.settings.autoStartBreaks;
    let autoStarted = false;
    if (autoStart) autoStarted = this.start(atMs);

    return {
      from,
      to,
      focusMinutes,
      autoStarted,
      totalFocusSessions: this.totalFocusSessions,
    };
  }
}
