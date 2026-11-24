import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  LIMITS,
  normalizeSettings,
  clampInteger,
} from '../js/settings.js';

test('默认设置是一颗标准番茄', () => {
  assert.equal(DEFAULT_SETTINGS.focusMinutes, 25);
  assert.equal(DEFAULT_SETTINGS.shortBreakMinutes, 5);
  assert.equal(DEFAULT_SETTINGS.longBreakMinutes, 15);
  assert.equal(DEFAULT_SETTINGS.longBreakInterval, 4);
  assert.equal(DEFAULT_SETTINGS.theme, 'system');
  assert.equal(DEFAULT_SETTINGS.sound, true);
});

test('每个数值都在合法范围内', () => {
  const settings = normalizeSettings({});
  for (const [key, limit] of Object.entries(LIMITS)) {
    assert.ok(settings[key] >= limit.min, `${key} 应不小于最小值`);
    assert.ok(settings[key] <= limit.max, `${key} 应不大于最大值`);
  }
});

test('越界或非法数值被修正', () => {
  const settings = normalizeSettings({
    focusMinutes: 0,
    shortBreakMinutes: 999,
    longBreakMinutes: '30',
    longBreakInterval: 1,
  });
  assert.equal(settings.focusMinutes, 1);
  assert.equal(settings.shortBreakMinutes, 60);
  assert.equal(settings.longBreakMinutes, 30);
  assert.equal(settings.longBreakInterval, 2);

  const garbage = normalizeSettings({
    focusMinutes: 'abc',
    shortBreakMinutes: NaN,
    longBreakMinutes: null,
    longBreakInterval: {},
  });
  assert.equal(garbage.focusMinutes, DEFAULT_SETTINGS.focusMinutes);
  assert.equal(garbage.shortBreakMinutes, DEFAULT_SETTINGS.shortBreakMinutes);
  assert.equal(garbage.longBreakMinutes, DEFAULT_SETTINGS.longBreakMinutes);
  assert.equal(garbage.longBreakInterval, DEFAULT_SETTINGS.longBreakInterval);
});

test('小数会四舍五入为整数', () => {
  assert.equal(normalizeSettings({ focusMinutes: 25.4 }).focusMinutes, 25);
  assert.equal(normalizeSettings({ focusMinutes: 25.6 }).focusMinutes, 26);
});

test('布尔值与主题被归一化', () => {
  const settings = normalizeSettings({
    autoStartBreaks: 'yes',
    autoStartFocus: 1,
    sound: false,
    notifications: 0,
    theme: 'neon',
  });
  assert.equal(settings.autoStartBreaks, true);
  assert.equal(settings.autoStartFocus, true);
  assert.equal(settings.sound, false);
  assert.equal(settings.notifications, false);
  assert.equal(settings.theme, 'system');

  assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
});

test('clampInteger 的边界行为', () => {
  assert.equal(clampInteger(5, 1, 10, 3), 5);
  assert.equal(clampInteger(0, 1, 10, 3), 1);
  assert.equal(clampInteger(11, 1, 10, 3), 10);
  assert.equal(clampInteger('7', 1, 10, 3), 7);
  assert.equal(clampInteger('nope', 1, 10, 3), 3);
});
