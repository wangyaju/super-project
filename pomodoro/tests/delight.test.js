import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACHIEVEMENTS,
  BLOOM_EVERY,
  GARDEN_LIMIT,
  QUIPS,
  achievementStatus,
  dayStreaks,
  gardenPlants,
  gardenSummary,
  mascotMood,
  normalizeDelight,
  pickQuip,
  statsSnapshot,
} from '../js/delight.js';

const DAY = 86_400_000;
const TODAY = new Date(2026, 10, 24, 12);

/** 构造一份按本地日期归档的统计。 */
function makeStats(total, days = {}) {
  return { totalFocusSessions: total, days };
}

function statsWithStreak(length) {
  const days = {};
  for (let offset = 0; offset < length; offset += 1) {
    const date = new Date(2026, 10, 24 - offset, 10);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    days[key] = { sessions: 1, minutes: 25 };
  }
  return makeStats(length, days);
}

test('陪伴表情随模式与状态变化', () => {
  assert.equal(mascotMood('focus', 'idle'), 'calm');
  assert.equal(mascotMood('focus', 'running'), 'focus');
  assert.equal(mascotMood('focus', 'paused'), 'sleepy');
  assert.equal(mascotMood('shortBreak', 'running'), 'relaxed');
  assert.equal(mascotMood('longBreak', 'paused'), 'sleepy');
});

test('台词按状态稳定选择，seed 相同则结果相同', () => {
  const lines = QUIPS.focus.running;
  assert.ok(lines.length > 0);

  for (let seed = 0; seed < lines.length * 2; seed += 1) {
    assert.equal(pickQuip('focus', 'running', seed), lines[seed % lines.length]);
    assert.equal(pickQuip('focus', 'running', seed), pickQuip('focus', 'running', seed));
  }

  assert.equal(pickQuip('focus', 'running', -1), lines[1 % lines.length]);
  assert.equal(pickQuip('focus', 'running', Number.NaN), lines[0]);
  assert.equal(pickQuip('unknown-mode', 'running', 0), QUIPS.focus.running[0]);
});

test('花园按累计番茄生成，最近的一颗在末尾', () => {
  assert.deepEqual(gardenPlants(0), []);
  assert.deepEqual(gardenPlants(2), [
    { index: 1, kind: 'tomato' },
    { index: 2, kind: 'tomato' },
  ]);

  const plants = gardenPlants(18);
  assert.equal(plants.length, GARDEN_LIMIT);
  assert.equal(plants[0].index, 18 - GARDEN_LIMIT + 1);
  assert.equal(plants.at(-1).index, 18);
  assert.deepEqual(
    plants.filter((plant) => plant.kind === 'flower').map((plant) => plant.index),
    [8, 12, 16].filter((index) => index % BLOOM_EVERY === 0),
  );
});

test('花园概览记录被收起的历史颗数', () => {
  assert.deepEqual(gardenSummary(0), { total: 0, plants: [], hidden: 0 });
  assert.deepEqual(gardenSummary(18), {
    total: 18,
    plants: gardenPlants(18),
    hidden: 18 - GARDEN_LIMIT,
  });
  assert.equal(gardenSummary(3).hidden, 0);
});

test('连续天数统计今天与历史最长连击', () => {
  const days = {
    '2026-11-24': { sessions: 2, minutes: 50 },
    '2026-11-23': { sessions: 1, minutes: 25 },
    '2026-11-22': { sessions: 0, minutes: 0 },
    '2026-11-20': { sessions: 1, minutes: 25 },
    '2026-11-19': { sessions: 1, minutes: 25 },
    '2026-11-18': { sessions: 1, minutes: 25 },
    '2026-11-17': { sessions: 1, minutes: 25 },
  };
  assert.deepEqual(dayStreaks(makeStats(10, days), TODAY), { current: 2, longest: 4 });
});

test('今天还没开始时，连续天数从昨天起算', () => {
  const stats = statsWithStreak(4);
  delete stats.days['2026-11-24'];
  assert.deepEqual(dayStreaks(stats, TODAY), { current: 3, longest: 3 });
});

test('空数据与未来日期不会产生连击', () => {
  assert.deepEqual(dayStreaks(makeStats(0), TODAY), { current: 0, longest: 0 });
  assert.deepEqual(
    dayStreaks(
      makeStats(1, { '2026-11-30': { sessions: 1, minutes: 25 } }),
      TODAY,
    ),
    { current: 0, longest: 0 },
  );
});

test('统计快照汇总单日峰值与连击', () => {
  const stats = statsWithStreak(4);
  stats.days['2026-11-24'] = { sessions: 6, minutes: 150 };
  const snapshot = statsSnapshot(makeStats(9, stats.days), TODAY);
  assert.deepEqual(snapshot, {
    total: 9,
    maxDay: 6,
    currentStreak: 4,
    longestStreak: 4,
  });
});

test('成就随统计解锁并暴露进度', () => {
  const fresh = achievementStatus(makeStats(0), TODAY);
  assert.equal(fresh.length, ACHIEVEMENTS.length);
  assert.ok(fresh.every((achievement) => achievement.unlocked === false));
  assert.ok(fresh.every((achievement) => achievement.value === 0));

  const stats = statsWithStreak(4);
  stats.days['2026-11-24'] = { sessions: 5, minutes: 125 };
  const status = achievementStatus(makeStats(5, stats.days), TODAY);
  const unlocked = status.filter((achievement) => achievement.unlocked).map(({ id }) => id);

  assert.deepEqual(unlocked, ['first-tomato', 'four-a-day', 'three-day-streak']);

  const four = status.find((achievement) => achievement.id === 'four-a-day');
  assert.equal(four.value, 5);
  assert.equal(four.target, 4);

  const eight = status.find((achievement) => achievement.id === 'eight-a-day');
  assert.equal(eight.unlocked, false);
  assert.equal(eight.value, 5);
});

test('五颗番茄即可解锁“一日四颗”与“第一颗”', () => {
  const status = achievementStatus(
    makeStats(5, { '2026-11-24': { sessions: 5, minutes: 125 } }),
    TODAY,
  );
  assert.deepEqual(
    status.filter((achievement) => achievement.unlocked).map(({ id }) => id),
    ['first-tomato', 'four-a-day'],
  );
});

test('趣味状态归一化只保留合法成就 id', () => {
  assert.deepEqual(normalizeDelight(null), { seen: [] });
  assert.deepEqual(normalizeDelight({ seen: 'nope' }), { seen: [] });
  assert.deepEqual(
    normalizeDelight({ seen: ['four-a-day', 'ghost', 'first-tomato', 'four-a-day'] }),
    { seen: ['first-tomato', 'four-a-day'] },
  );
});

test('连续天数跨月计算正确', () => {
  const days = {
    '2026-10-31': { sessions: 1, minutes: 25 },
    '2026-11-01': { sessions: 1, minutes: 25 },
    '2026-11-02': { sessions: 1, minutes: 25 },
  };
  assert.deepEqual(dayStreaks(makeStats(3, days), new Date(2026, 10, 2, 9)), {
    current: 3,
    longest: 3,
  });
  assert.equal(DAY, 86_400_000);
});
