/** 每天专注统计，按本地日期归档。 */

export const KEEP_DAYS = 120;

export function createStats() {
  return { totalFocusSessions: 0, days: {} };
}

/** 本地时区的 YYYY-MM-DD。 */
export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDayKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeStats(input) {
  const stats = createStats();
  if (!input || typeof input !== 'object') return stats;

  stats.totalFocusSessions = Math.max(0, Math.floor(Number(input.totalFocusSessions) || 0));

  const days = input.days && typeof input.days === 'object' ? input.days : {};
  for (const [key, value] of Object.entries(days)) {
    if (!isDayKey(key) || !value || typeof value !== 'object') continue;
    const sessions = Math.max(0, Math.floor(Number(value.sessions) || 0));
    const minutes = Math.max(0, Math.round(Number(value.minutes) || 0));
    if (sessions === 0 && minutes === 0) continue;
    stats.days[key] = { sessions, minutes };
  }
  return stats;
}

function pruneOldDays(stats, at) {
  const cutoff = new Date(at.getFullYear(), at.getMonth(), at.getDate() - KEEP_DAYS);
  const cutoffKey = dayKey(cutoff);
  for (const key of Object.keys(stats.days)) {
    if (key < cutoffKey) delete stats.days[key];
  }
}

/** 记录一次完成的专注，返回新的统计对象（不修改入参）。 */
export function recordFocusSession(stats, { minutes, at = new Date() }) {
  const next = normalizeStats(stats);
  const key = dayKey(at);
  const day = next.days[key] ?? { sessions: 0, minutes: 0 };
  next.days[key] = {
    sessions: day.sessions + 1,
    minutes: day.minutes + Math.max(0, Math.round(Number(minutes) || 0)),
  };
  next.totalFocusSessions += 1;
  pruneOldDays(next, at);
  return next;
}

export function todaySummary(stats, at = new Date()) {
  const day = stats.days?.[dayKey(at)];
  return { sessions: day?.sessions ?? 0, minutes: day?.minutes ?? 0 };
}

/** 最近 count 天（含今天）的数据，按日期升序。 */
export function lastDays(stats, count = 7, at = new Date()) {
  const days = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(at.getFullYear(), at.getMonth(), at.getDate() - offset);
    const key = dayKey(date);
    const day = stats.days?.[key];
    days.push({
      key,
      date,
      sessions: day?.sessions ?? 0,
      minutes: day?.minutes ?? 0,
    });
  }
  return days;
}
