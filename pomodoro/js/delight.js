/**
 * 趣味化数据逻辑：陪伴角色、番茄藤、小花园、连续天数与成就。
 *
 * 这里只包含不依赖 DOM 的纯函数，方便单元测试。界面状态只保存“已看过
 * 的成就”，花园和成就本身都由专注统计推导，避免额外的数据迁移。
 */

/** 花园里最多同时展示的番茄数量。 */
export const GARDEN_LIMIT = 12;

/** 每完成多少颗番茄，花园里多开一朵花。 */
export const BLOOM_EVERY = 4;

export const QUIPS = {
  focus: {
    idle: ['准备好后，开始第一颗番茄', '种下一颗番茄，25 分钟后收获', '深呼吸，把注意力收回来'],
    running: ['番茄正在悄悄长大', '一次只做一件事，慢慢来比较快', '专注的人，时间过得很快'],
    paused: ['番茄在等你回来', '暂停一下也没关系，回来继续'],
  },
  shortBreak: {
    idle: ['起来走走，喝口水', '让眼睛看看远处', '休息也是专注的一部分'],
    running: ['离开屏幕，让眼睛休息一下', '伸个懒腰，番茄也在休息'],
    paused: ['休息暂停中，按空格继续', '不着急，休息够了再回来'],
  },
  longBreak: {
    idle: ['完成一轮，好好放松', '泡杯茶，奖励自己一下'],
    running: ['这一轮结束了，尽情休息', '看看窗外，让大脑放空'],
    paused: ['长休息暂停中，按空格继续', '慢慢来，还有时间'],
  },
};

const DEFAULT_QUIPS = QUIPS.focus;
const DAY_MS = 86_400_000;

/** 当前应当展示的陪伴表情：calm / focus / sleepy / relaxed / party。 */
export function mascotMood(mode, status) {
  if (status === 'paused') return 'sleepy';
  if (mode === 'focus') return status === 'running' ? 'focus' : 'calm';
  return 'relaxed';
}

/**
 * 根据模式与状态挑一句台词。seed 通常是累计番茄数，
 * 保证同一状态下文案稳定，不会每次渲染都跳动。
 */
export function pickQuip(mode, status, seed = 0) {
  const byStatus = QUIPS[mode] ?? DEFAULT_QUIPS;
  const lines = byStatus[status] ?? byStatus.idle;
  const numeric = Math.trunc(Number(seed));
  const index = (Number.isFinite(numeric) ? Math.abs(numeric) : 0) % lines.length;
  return lines[index];
}

/** 把累计番茄数映射为花园里的一排植物（只保留最近的若干颗）。 */
export function gardenPlants(totalFocusSessions, limit = GARDEN_LIMIT) {
  const total = Math.max(0, Math.floor(Number(totalFocusSessions) || 0));
  const shown = Math.min(total, Math.max(0, Math.floor(Number(limit) || 0)));
  const start = total - shown + 1;
  const plants = [];

  for (let offset = 0; offset < shown; offset += 1) {
    const index = start + offset;
    plants.push({
      index,
      kind: index % BLOOM_EVERY === 0 ? 'flower' : 'tomato',
    });
  }
  return plants;
}

/** 花园概览：总数、展示的植物以及被收起来的历史颗数。 */
export function gardenSummary(totalFocusSessions, limit = GARDEN_LIMIT) {
  const total = Math.max(0, Math.floor(Number(totalFocusSessions) || 0));
  const plants = gardenPlants(total, limit);
  return { total, plants, hidden: Math.max(0, total - plants.length) };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function isDayKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 本地日期的 UTC 零点时间戳，用整天差值比较，避免夏令时误差。 */
function utcDay(time) {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function keyFromUtcDay(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * 连续专注天数。
 * - current：截至今天（今天还没开始时允许从昨天起算）的连续天数
 * - longest：历史最长连续天数
 */
export function dayStreaks(stats, at = new Date()) {
  const today = utcDay(at.getTime());
  const entries = [];

  for (const [key, value] of Object.entries(stats?.days ?? {})) {
    if (!isDayKey(key) || !value || Number(value.sessions) <= 0) continue;
    const [year, month, day] = key.split('-').map(Number);
    const time = Date.UTC(year, month - 1, day);
    if (time > today) continue;
    entries.push({ key, time });
  }

  entries.sort((left, right) => left.time - right.time);

  let longest = 0;
  let run = 0;
  let previous = null;
  for (const entry of entries) {
    run = previous !== null && entry.time - previous === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = entry.time;
  }

  const activeDays = new Set(entries.map((entry) => entry.key));
  let cursor = today;
  if (!activeDays.has(keyFromUtcDay(cursor))) cursor -= DAY_MS;

  let current = 0;
  while (activeDays.has(keyFromUtcDay(cursor))) {
    current += 1;
    cursor -= DAY_MS;
  }

  return { current, longest };
}

/**
 * 成就定义。metric 对应 statsSnapshot 的字段，达到 target 即解锁。
 * hint 同时用于徽章提示与解锁播报。
 */
export const ACHIEVEMENTS = Object.freeze([
  {
    id: 'first-tomato',
    title: '第一颗番茄',
    icon: '🍅',
    hint: '完成第一次专注',
    metric: 'total',
    target: 1,
  },
  {
    id: 'four-a-day',
    title: '一日四颗',
    icon: '🌱',
    hint: '单日完成 4 颗番茄',
    metric: 'maxDay',
    target: 4,
  },
  {
    id: 'eight-a-day',
    title: '超级专注日',
    icon: '⭐',
    hint: '单日完成 8 颗番茄',
    metric: 'maxDay',
    target: 8,
  },
  {
    id: 'three-day-streak',
    title: '三日连击',
    icon: '🔥',
    hint: '连续 3 天专注',
    metric: 'longestStreak',
    target: 3,
  },
  {
    id: 'seven-day-streak',
    title: '七日园丁',
    icon: '🏆',
    hint: '连续 7 天专注',
    metric: 'longestStreak',
    target: 7,
  },
  {
    id: 'fifty-tomatoes',
    title: '五十颗收获',
    icon: '🧺',
    hint: '累计完成 50 颗番茄',
    metric: 'total',
    target: 50,
  },
]);

/** 成就判定需要的最小快照。 */
export function statsSnapshot(stats, at = new Date()) {
  let maxDay = 0;
  for (const day of Object.values(stats?.days ?? {})) {
    if (!day) continue;
    maxDay = Math.max(maxDay, Math.floor(Number(day.sessions) || 0));
  }

  const streaks = dayStreaks(stats, at);
  return {
    total: Math.max(0, Math.floor(Number(stats?.totalFocusSessions) || 0)),
    maxDay,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
  };
}

/** 每个成就的进度与解锁状态。 */
export function achievementStatus(stats, at = new Date()) {
  const snapshot = statsSnapshot(stats, at);
  return ACHIEVEMENTS.map((achievement) => {
    const value = Math.max(0, snapshot[achievement.metric] ?? 0);
    return {
      ...achievement,
      value,
      unlocked: value >= achievement.target,
    };
  });
}

/** 归一化“趣味化”本地状态，只保留合法的已看成就 id。 */
export function normalizeDelight(input) {
  const seen = new Set(Array.isArray(input?.seen) ? input.seen : []);
  return {
    seen: ACHIEVEMENTS.filter((achievement) => seen.has(achievement.id)).map(
      (achievement) => achievement.id,
    ),
  };
}
