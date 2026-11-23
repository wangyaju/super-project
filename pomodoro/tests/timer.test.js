import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PomodoroEngine,
  MODE_LABELS,
  MODES,
  formatClock,
  modeDurationMs,
} from '../js/timer.js';

const MINUTE = 60_000;

const BASE_SETTINGS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

function setup(overrides = {}) {
  let now = 0;
  const engine = new PomodoroEngine({
    settings: { ...BASE_SETTINGS, ...overrides },
    now: () => now,
  });
  return {
    engine,
    advance(ms) {
      now += ms;
      return now;
    },
    get now() {
      return now;
    },
  };
}

function completeCurrentPhase(clock) {
  clock.engine.start();
  clock.advance(clock.engine.remainingMs);
  return clock.engine.tick();
}

test('模式常量与标签完整', () => {
  assert.deepEqual(MODES, ['focus', 'shortBreak', 'longBreak']);
  assert.deepEqual(MODE_LABELS, {
    focus: '专注',
    shortBreak: '短休息',
    longBreak: '长休息',
  });
});

test('初始状态为 25 分钟专注且处于空闲', () => {
  const { engine } = setup();
  assert.equal(engine.mode, 'focus');
  assert.equal(engine.status, 'idle');
  assert.equal(engine.remainingMs, 25 * MINUTE);
  assert.equal(engine.totalMs, 25 * MINUTE);
});

test('开始计时后按真实时间递减剩余毫秒', () => {
  const clock = setup();
  clock.engine.start();
  clock.advance(60_000 + 1_500);
  assert.equal(clock.engine.tick(), null);
  assert.equal(clock.engine.remainingMs, 25 * MINUTE - 61_500);
  assert.equal(clock.engine.status, 'running');
});

test('未运行时 tick 不产生变化', () => {
  const clock = setup();
  clock.advance(60_000);
  assert.equal(clock.engine.tick(), null);
  assert.equal(clock.engine.remainingMs, 25 * MINUTE);
});

test('暂停会冻结剩余时间，继续后恢复', () => {
  const clock = setup();
  clock.engine.start();
  clock.advance(10 * MINUTE);
  clock.engine.tick();
  assert.equal(clock.engine.pause(), true);
  assert.equal(clock.engine.remainingMs, 15 * MINUTE);
  assert.equal(clock.engine.status, 'paused');

  clock.advance(30 * MINUTE);
  assert.equal(clock.engine.tick(), null);
  assert.equal(clock.engine.remainingMs, 15 * MINUTE);

  clock.engine.start();
  clock.advance(5 * MINUTE);
  clock.engine.tick();
  assert.equal(clock.engine.remainingMs, 10 * MINUTE);
});

test('专注结束后进入短休息，并累计完成数', () => {
  const clock = setup();
  const event = completeCurrentPhase(clock);

  assert.deepEqual(
    {
      from: event.from,
      to: event.to,
      focusMinutes: event.focusMinutes,
      autoStarted: event.autoStarted,
      totalFocusSessions: event.totalFocusSessions,
    },
    {
      from: 'focus',
      to: 'shortBreak',
      focusMinutes: 25,
      autoStarted: false,
      totalFocusSessions: 1,
    },
  );
  assert.equal(clock.engine.mode, 'shortBreak');
  assert.equal(clock.engine.status, 'idle');
  assert.equal(clock.engine.remainingMs, 5 * MINUTE);
});

test('休息结束后回到专注，且不计入专注数', () => {
  const clock = setup();
  completeCurrentPhase(clock);
  const event = completeCurrentPhase(clock);

  assert.equal(event.from, 'shortBreak');
  assert.equal(event.to, 'focus');
  assert.equal(event.focusMinutes, 0);
  assert.equal(clock.engine.totalFocusSessions, 1);
  assert.equal(clock.engine.remainingMs, 25 * MINUTE);
});

test('每完成 N 个专注后进入长休息', () => {
  const clock = setup({ focusMinutes: 1, shortBreakMinutes: 1, longBreakInterval: 3 });
  const modes = [];

  for (let index = 0; index < 3; index += 1) {
    clock.engine.select('focus');
    modes.push(completeCurrentPhase(clock).to);
  }

  assert.deepEqual(modes, ['shortBreak', 'shortBreak', 'longBreak']);
  assert.equal(clock.engine.totalFocusSessions, 3);
  assert.equal(clock.engine.mode, 'longBreak');
  assert.equal(clock.engine.remainingMs, 15 * MINUTE);
});

test('自动开始休息与自动开始专注', () => {
  const clock = setup({ autoStartBreaks: true, autoStartFocus: true });

  const focusEvent = completeCurrentPhase(clock);
  assert.equal(focusEvent.autoStarted, true);
  assert.equal(clock.engine.status, 'running');
  assert.equal(clock.engine.mode, 'shortBreak');

  clock.advance(5 * MINUTE);
  const breakEvent = clock.engine.tick();
  assert.equal(breakEvent.autoStarted, true);
  assert.equal(clock.engine.status, 'running');
  assert.equal(clock.engine.mode, 'focus');
});

test('跳过专注不会累计完成数，也不发长休息', () => {
  const clock = setup({ longBreakInterval: 2 });
  clock.engine.totalFocusSessions = 1;

  const skipped = clock.engine.skip();
  assert.equal(skipped.from, 'focus');
  assert.equal(skipped.to, 'shortBreak');
  assert.equal(clock.engine.mode, 'shortBreak');
  assert.equal(clock.engine.status, 'idle');
  assert.equal(clock.engine.totalFocusSessions, 1);
  assert.equal(clock.engine.remainingMs, 5 * MINUTE);

  const next = clock.engine.skip();
  assert.equal(next.to, 'focus');
  assert.equal(clock.engine.mode, 'focus');
});

test('reset 恢复当前模式的完整时长', () => {
  const clock = setup();
  clock.engine.start();
  clock.advance(3 * MINUTE);
  clock.engine.tick();
  clock.engine.reset();
  assert.equal(clock.engine.status, 'idle');
  assert.equal(clock.engine.remainingMs, 25 * MINUTE);
});

test('手动选择模式会重置计时且不改变累计数', () => {
  const clock = setup();
  clock.engine.start();
  clock.advance(2 * MINUTE);
  clock.engine.tick();
  assert.equal(clock.engine.select('longBreak'), true);
  assert.equal(clock.engine.mode, 'longBreak');
  assert.equal(clock.engine.status, 'idle');
  assert.equal(clock.engine.remainingMs, 15 * MINUTE);
  assert.equal(clock.engine.totalFocusSessions, 0);
  assert.equal(clock.engine.select('nope'), false);
});

test('空闲时修改设置立即应用新时长，运行中则留到下一阶段', () => {
  const idle = setup();
  idle.engine.changeSettings({ ...BASE_SETTINGS, focusMinutes: 30 });
  assert.equal(idle.engine.remainingMs, 30 * MINUTE);

  const running = setup();
  running.engine.start();
  running.advance(1 * MINUTE);
  running.engine.tick();
  running.engine.changeSettings({
    ...BASE_SETTINGS,
    focusMinutes: 50,
    shortBreakMinutes: 10,
  });
  assert.equal(running.engine.remainingMs, 24 * MINUTE);

  running.advance(24 * MINUTE);
  const event = running.engine.tick();
  assert.equal(event.to, 'shortBreak');
  assert.equal(event.focusMinutes, 25);
  assert.equal(running.engine.remainingMs, 10 * MINUTE);
});

test('时钟格式化', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(1_000), '00:01');
  assert.equal(formatClock(1_500), '00:02');
  assert.equal(formatClock(61_000), '01:01');
  assert.equal(formatClock(25 * MINUTE), '25:00');
  assert.equal(formatClock(-5_000), '00:00');
});

test('各模式的时长计算', () => {
  assert.equal(modeDurationMs(BASE_SETTINGS, 'focus'), 25 * MINUTE);
  assert.equal(modeDurationMs(BASE_SETTINGS, 'shortBreak'), 5 * MINUTE);
  assert.equal(modeDurationMs(BASE_SETTINGS, 'longBreak'), 15 * MINUTE);
  assert.equal(
    modeDurationMs({ ...BASE_SETTINGS, focusMinutes: 0 }, 'focus'),
    MINUTE,
  );
});
