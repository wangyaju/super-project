import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStats,
  dayKey,
  normalizeStats,
  recordFocusSession,
  todaySummary,
  lastDays,
} from '../js/stats.js';

test('dayKey 使用本地日期', () => {
  assert.equal(dayKey(new Date(2026, 10, 23, 8, 30)), '2026-11-23');
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('空统计结构完整', () => {
  const stats = createStats();
  assert.equal(stats.totalFocusSessions, 0);
  assert.deepEqual(stats.days, {});
  assert.deepEqual(normalizeStats(null), stats);
});

test('记录一次专注会累计当日与总数，且不修改入参', () => {
  const before = createStats();
  const at = new Date(2026, 10, 23, 10);

  const after = recordFocusSession(before, { minutes: 25, at });
  assert.equal(before.totalFocusSessions, 0);
  assert.deepEqual(before.days, {});

  assert.equal(after.totalFocusSessions, 1);
  assert.deepEqual(after.days['2026-11-23'], { sessions: 1, minutes: 25 });

  const again = recordFocusSession(after, { minutes: 30, at });
  assert.equal(again.totalFocusSessions, 2);
  assert.deepEqual(again.days['2026-11-23'], { sessions: 2, minutes: 55 });
});

test('不同日期分开归档，今日统计只取当天', () => {
  const dayOne = new Date(2026, 10, 22, 9);
  const dayTwo = new Date(2026, 10, 23, 9);
  let stats = recordFocusSession(createStats(), { minutes: 25, at: dayOne });
  stats = recordFocusSession(stats, { minutes: 25, at: dayTwo });
  stats = recordFocusSession(stats, { minutes: 25, at: dayTwo });

  assert.deepEqual(todaySummary(stats, dayTwo), { sessions: 2, minutes: 50 });
  assert.deepEqual(todaySummary(stats, new Date(2026, 10, 24)), {
    sessions: 0,
    minutes: 0,
  });
});

test('最近 7 天按时间升序且包含今天', () => {
  const today = new Date(2026, 10, 23, 12);
  let stats = createStats();
  stats = recordFocusSession(stats, { minutes: 25, at: today });
  stats = recordFocusSession(stats, {
    minutes: 25,
    at: new Date(2026, 10, 20, 12),
  });

  const week = lastDays(stats, 7, today);
  assert.equal(week.length, 7);
  assert.equal(week.at(-1).key, '2026-11-23');
  assert.equal(week.at(-1).sessions, 1);
  assert.equal(week[0].key, '2026-11-17');
  assert.equal(week.find((day) => day.key === '2026-11-20').sessions, 1);
  assert.equal(week[0].sessions, 0);

  const keys = week.map((day) => day.key);
  assert.deepEqual(keys, [...keys].sort());
});

test('超过保留期的旧数据会被清理', () => {
  let stats = normalizeStats({
    totalFocusSessions: 1,
    days: {
      '2026-01-01': { sessions: 1, minutes: 25 },
      '2025-12-31': { sessions: 1, minutes: 25 },
    },
  });

  stats = recordFocusSession(stats, {
    minutes: 25,
    at: new Date(2026, 10, 23, 12),
  });
  assert.equal(stats.days['2026-01-01'], undefined);
  assert.equal(stats.days['2025-12-31'], undefined);
  assert.deepEqual(stats.days['2026-11-23'], { sessions: 1, minutes: 25 });
});

test('归一化会丢弃非法日期和非法记录', () => {
  const stats = normalizeStats({
    totalFocusSessions: -5,
    days: {
      'not-a-date': { sessions: 2, minutes: 50 },
      '2026-11-23': { sessions: '2', minutes: '50' },
      '2026-11-24': { sessions: 0, minutes: 0 },
      '2026-11-25': null,
    },
  });

  assert.equal(stats.totalFocusSessions, 0);
  assert.deepEqual(stats.days['2026-11-23'], { sessions: 2, minutes: 50 });
  assert.equal(stats.days['not-a-date'], undefined);
  assert.equal(stats.days['2026-11-24'], undefined);
  assert.equal(stats.days['2026-11-25'], undefined);
});
