import { PomodoroEngine, MODE_LABELS, formatClock } from './timer.js';
import {
  DEFAULT_SETTINGS,
  THEME_LABELS,
  THEMES,
  normalizeSettings,
  clampInteger,
} from './settings.js';
import {
  normalizeStats,
  recordFocusSession,
  todaySummary,
  lastDays,
} from './stats.js';
import { getStorage, readJSON, writeJSON } from './store.js';
import {
  achievementStatus,
  gardenSummary,
  mascotMood,
  normalizeDelight,
  pickQuip,
  statsSnapshot,
} from './delight.js';

const STORAGE_KEYS = {
  settings: 'pomodoro.settings.v1',
  stats: 'pomodoro.stats.v1',
  tasks: 'pomodoro.tasks.v1',
  delight: 'pomodoro.delight.v1',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const RING_RADIUS = 103;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** @type {Record<string, HTMLElement>} */
const el = {
  timerCard: document.querySelector('#timer'),
  timeDisplay: document.querySelector('#timeDisplay'),
  modeLabel: document.querySelector('#modeLabel'),
  phaseHint: document.querySelector('#phaseHint'),
  ringValue: document.querySelector('#ringValue'),
  cycleDots: document.querySelector('#cycleDots'),
  startBtn: document.querySelector('#startBtn'),
  resetBtn: document.querySelector('#resetBtn'),
  skipBtn: document.querySelector('#skipBtn'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  themeToggle: document.querySelector('#themeToggle'),
  themeMenuToggle: document.querySelector('#themeMenuToggle'),
  themeMenu: document.querySelector('#themeMenu'),
  themeOptions: document.querySelector('#themeOptions'),
  openSettings: document.querySelector('#openSettings'),
  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  resetSettings: document.querySelector('#resetSettings'),
  taskForm: document.querySelector('#taskForm'),
  taskTitle: document.querySelector('#taskTitle'),
  taskEstimate: document.querySelector('#taskEstimate'),
  taskList: document.querySelector('#taskList'),
  taskEmpty: document.querySelector('#taskEmpty'),
  taskSummary: document.querySelector('#taskSummary'),
  todaySessions: document.querySelector('#todaySessions'),
  todayMinutes: document.querySelector('#todayMinutes'),
  statsTotal: document.querySelector('#statsTotal'),
  weekChart: document.querySelector('#weekChart'),
  garden: document.querySelector('#miniGarden'),
  gardenMeta: document.querySelector('#gardenMeta'),
  streakChip: document.querySelector('#streakChip'),
  badgeList: document.querySelector('#badgeList'),
  badgeMeta: document.querySelector('#badgeMeta'),
  confetti: document.querySelector('#confetti'),
  harvestBanner: document.querySelector('#harvestBanner'),
  harvestIcon: document.querySelector('#harvestIcon'),
  harvestTitle: document.querySelector('#harvestTitle'),
  harvestDetail: document.querySelector('#harvestDetail'),
  liveStatus: document.querySelector('#liveStatus'),
};

const storage = getStorage();
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

let settings = normalizeSettings(readJSON(storage, STORAGE_KEYS.settings, DEFAULT_SETTINGS));
let stats = normalizeStats(readJSON(storage, STORAGE_KEYS.stats, null));
let tasks = normalizeTasks(readJSON(storage, STORAGE_KEYS.tasks, null));
let delight = normalizeDelight(readJSON(storage, STORAGE_KEYS.delight, null));
const engine = new PomodoroEngine({
  settings,
  totalFocusSessions: stats.totalFocusSessions,
});

let announceTimer = null;
let audioContext = null;
let notificationPrompted = false;
let lastHintKey = '';
let lastCycleSignature = '';
let lastGardenTotal = stats.totalFocusSessions;
let celebrateUntil = 0;
let celebrateTimer = null;
let bannerTimer = null;
const bannerQueue = [];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */

function persistSettings() {
  writeJSON(storage, STORAGE_KEYS.settings, settings);
}

function persistStats() {
  writeJSON(storage, STORAGE_KEYS.stats, stats);
}

function persistTasks() {
  writeJSON(storage, STORAGE_KEYS.tasks, tasks);
}

function persistDelight() {
  writeJSON(storage, STORAGE_KEYS.delight, delight);
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function announce(message) {
  window.clearTimeout(announceTimer);
  el.liveStatus.textContent = '';
  announceTimer = window.setTimeout(() => {
    el.liveStatus.textContent = message;
  }, 60);
}

function normalizeTasks(value) {
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : [];

  const items = [];
  const seenIds = new Set();
  for (const raw of rawItems.slice(0, 100)) {
    if (!raw || typeof raw !== 'object') continue;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : '';
    if (!title) continue;

    let id =
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : `task-${items.length}-${Date.now().toString(36)}`;
    while (seenIds.has(id)) id = `${id}-x`;
    seenIds.add(id);

    items.push({
      id,
      title,
      estimate: clampInteger(raw.estimate, 1, 20, 1),
      sessions: clampInteger(raw.sessions, 0, 9999, 0),
      done: Boolean(raw.done),
    });
  }

  const requestedActive = typeof value?.activeId === 'string' ? value.activeId : null;
  const activeId = items.some((task) => task.id === requestedActive && !task.done)
    ? requestedActive
    : (items.find((task) => !task.done)?.id ?? null);

  return { items, activeId };
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function tomatoIconSvg() {
  const svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    svgNode('circle', { class: 'tomato-fruit', cx: '12', cy: '16', r: '7.2' }),
    svgNode('path', {
      class: 'tomato-leaf',
      d: 'M12 8.6c-1.5-1.8-3.4-2.3-5-1.9.9 1.2 1.7 2 3 2.3-1.5.2-2.6 1-3.4 2 1.9.4 3.5-.2 5.4-1.6 1.9 1.4 3.5 2 5.4 1.6-.8-1-1.9-1.8-3.4-2 1.3-.3 2.1-1.1 3-2.3-1.6-.4-3.5.1-5 1.9Z',
    }),
  );
  return svg;
}

function plantSvg(kind) {
  const svg = svgNode('svg', { viewBox: '0 0 28 40', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgNode('path', { class: 'plant-stem', d: 'M14 36V18' }));

  if (kind === 'flower') {
    const petals = [
      [14, 12.3],
      [18, 15.3],
      [16.5, 19.9],
      [11.5, 19.9],
      [10, 15.3],
    ];
    for (const [cx, cy] of petals) {
      svg.append(svgNode('circle', { class: 'plant-flower', cx, cy, r: '3.2' }));
    }
    svg.append(svgNode('circle', { class: 'plant-flower-core', cx: '14', cy: '16.5', r: '2.4' }));
  } else {
    svg.append(
      svgNode('circle', { class: 'plant-fruit', cx: '14', cy: '26', r: '6.4' }),
      svgNode('circle', { class: 'plant-shine', cx: '11.2', cy: '23.4', r: '2' }),
    );
  }

  svg.append(
    svgNode('path', {
      class: 'plant-leaf',
      d: 'M14 24c-4 .2-6.8-1.1-8.2-3.6 3.6-.5 6.2.4 8.2 2.9Z',
    }),
    svgNode('path', {
      class: 'plant-leaf',
      d: 'M14 29c4 .2 6.8-1.1 8.2-3.6-3.6-.5-6.2.4-8.2 2.9Z',
    }),
  );

  if (kind !== 'flower') {
    svg.append(
      svgNode('path', {
        class: 'plant-leaf plant-leaf-top',
        d: 'M14 21c-1.2-1.4-2.7-1.8-3.9-1.5.7.9 1.3 1.6 2.3 1.9-1.1.2-2 .8-2.7 1.6 1.5.3 2.8-.2 4.3-1.3 1.5 1.1 2.8 1.6 4.3 1.3-.7-.8-1.6-1.4-2.7-1.6 1-.3 1.6-1 2.3-1.9-1.2-.3-2.7.1-3.9 1.5Z',
      }),
    );
  }

  return svg;
}

/* ------------------------------------------------------------------ */
/* 主题                                                                */
/* ------------------------------------------------------------------ */

const THEME_META_COLORS = {
  light: '#f6f1e8',
  dark: '#171412',
  sakura: '#fbf1f2',
  forest: '#eef4ea',
  ocean: '#edf3f6',
};

function resolvedTheme() {
  if (settings.theme === 'system') return darkQuery.matches ? 'dark' : 'light';
  return settings.theme;
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = THEME_META_COLORS[theme] ?? THEME_META_COLORS.light;
  updateThemeButton();
  updateThemeMenu();
}

function updateThemeButton() {
  const isDark = resolvedTheme() === 'dark';
  const label = isDark ? '切换到浅色主题' : '切换到深色主题';
  el.themeToggle.setAttribute('aria-label', label);
  el.themeToggle.setAttribute('title', label);
  el.themeToggle.setAttribute('aria-pressed', String(isDark));
}

function renderThemeOptions() {
  const selectOptions = THEMES.map((theme) => {
    const option = document.createElement('option');
    option.value = theme;
    option.textContent = THEME_LABELS[theme];
    return option;
  });
  el.settingsForm.elements.theme.replaceChildren(...selectOptions);

  const menuOptions = THEMES.map((theme) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.dataset.theme = theme;
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', 'false');

    const swatch = document.createElement('span');
    swatch.className = `theme-swatch is-${theme}`;
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'theme-option-label';
    label.textContent = THEME_LABELS[theme];

    const check = svgNode('svg', {
      class: 'theme-check',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    check.append(svgNode('path', { d: 'M5 12.5l4.2 4.2L19 6.8' }));

    option.append(swatch, label, check);
    return option;
  });
  el.themeOptions.replaceChildren(...menuOptions);
}

function updateThemeMenu() {
  const label = THEME_LABELS[settings.theme] ?? THEME_LABELS.system;
  el.themeMenuToggle.setAttribute('aria-label', `主题：${label}，打开主题菜单`);
  el.themeMenuToggle.title = `主题：${label}`;

  for (const option of el.themeOptions.querySelectorAll('.theme-option')) {
    option.setAttribute('aria-checked', String(option.dataset.theme === settings.theme));
  }
}

function setThemeMenuOpen(open) {
  el.themeMenu.hidden = !open;
  el.themeMenuToggle.setAttribute('aria-expanded', String(open));
  if (!open) return;

  const selected = el.themeOptions.querySelector(
    `.theme-option[data-theme="${settings.theme}"]`,
  );
  (selected ?? el.themeOptions.querySelector('.theme-option'))?.focus();
}

function chooseTheme(theme) {
  setThemeMenuOpen(false);
  el.themeMenuToggle.focus();
  if (!THEMES.includes(theme) || theme === settings.theme) return;

  settings.theme = theme;
  persistSettings();
  applyTheme();
  announce(theme === 'system' ? '主题已跟随系统' : `已切换到${THEME_LABELS[theme]}主题`);
}

/* ------------------------------------------------------------------ */
/* 计时器渲染与交互                                                    */
/* ------------------------------------------------------------------ */

function setRingFraction(fraction) {
  const clamped = Math.min(1, Math.max(0, fraction));
  el.ringValue.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
}

function modeMinutes(mode) {
  if (mode === 'focus') return settings.focusMinutes;
  if (mode === 'shortBreak') return settings.shortBreakMinutes;
  return settings.longBreakMinutes;
}

function renderTimer() {
  const clock = formatClock(engine.remainingMs);
  if (el.timeDisplay.textContent !== clock) el.timeDisplay.textContent = clock;

  el.modeLabel.textContent = MODE_LABELS[engine.mode];
  document.body.dataset.mode = engine.mode;
  setRingFraction(engine.remainingMs / (engine.totalMs || 1));

  const startLabel =
    engine.status === 'running' ? '暂停' : engine.status === 'paused' ? '继续' : '开始';
  if (el.startBtn.textContent !== startLabel) el.startBtn.textContent = startLabel;
  el.startBtn.setAttribute(
    'aria-label',
    engine.status === 'running'
      ? '暂停计时'
      : engine.status === 'paused'
        ? '继续计时'
        : `开始${MODE_LABELS[engine.mode]}`,
  );

  const mood = Date.now() < celebrateUntil ? 'party' : mascotMood(engine.mode, engine.status);
  if (el.timerCard.dataset.mood !== mood) el.timerCard.dataset.mood = mood;

  const hintKey = `${engine.mode}:${engine.status}`;
  if (hintKey !== lastHintKey) {
    lastHintKey = hintKey;
    el.phaseHint.textContent = pickQuip(engine.mode, engine.status, stats.totalFocusSessions);
  }

  for (const tab of el.modeTabs) {
    const mode = tab.dataset.mode;
    tab.setAttribute('aria-pressed', String(mode === engine.mode));
    const time = tab.querySelector('.mode-time');
    if (time) time.textContent = `${modeMinutes(mode)}′`;
  }

  const title = engine.isRunning ? `${clock} · ${MODE_LABELS[engine.mode]}` : '番茄钟';
  if (document.title !== title) document.title = title;

  renderCycle();
}

function renderCycle() {
  const interval = Math.max(1, settings.longBreakInterval);
  let filled = engine.totalFocusSessions % interval;
  if (engine.mode === 'longBreak' && engine.totalFocusSessions > 0 && filled === 0) {
    filled = interval;
  }

  const signature = `${filled}:${interval}:${engine.totalFocusSessions}`;
  if (signature === lastCycleSignature) return;
  lastCycleSignature = signature;

  const tomatoes = [];
  for (let index = 0; index < interval; index += 1) {
    const tomato = document.createElement('span');
    tomato.className = index < filled ? 'cycle-tomato is-done' : 'cycle-tomato';
    tomato.setAttribute('aria-hidden', 'true');
    tomato.append(tomatoIconSvg());
    tomatoes.push(tomato);
  }
  el.cycleDots.replaceChildren(...tomatoes);
  el.cycleDots.setAttribute(
    'aria-label',
    `本轮已完成 ${filled} 个番茄，共 ${interval} 个`,
  );
}

function toggleTimer() {
  unlockAudio();
  requestNotificationPermission();
  engine.toggle();
  renderTimer();
}

function resetTimer() {
  engine.reset();
  announce('计时已重置');
  renderTimer();
}

function skipTimer() {
  const { to } = engine.skip();
  announce(`已跳过，进入${MODE_LABELS[to]}`);
  renderTimer();
}

function tickLoop() {
  const event = engine.tick();
  if (event) handlePhaseComplete(event);
  renderTimer();
}

function handlePhaseComplete(event) {
  if (event.from === 'focus') {
    stats = recordFocusSession(stats, {
      minutes: event.focusMinutes,
      at: new Date(),
    });
    persistStats();

    const activeTask = tasks.items.find((task) => task.id === tasks.activeId);
    if (activeTask) {
      activeTask.sessions += 1;
      persistTasks();
    }

    celebrateHarvest(event);
  }

  const title = event.from === 'focus' ? '专注完成' : '休息结束';
  const body =
    event.from === 'focus'
      ? `${MODE_LABELS[event.to]} ${modeMinutes(event.to)} 分钟，起来活动一下。`
      : `开始下一个番茄，保持节奏。`;

  playChime();
  notify(title, body);

  const { fresh } = renderAll({ announceAchievements: event.from === 'focus' });
  const achievementNote = fresh.length
    ? `，解锁成就：${fresh.map((item) => item.title).join('、')}`
    : '';
  announce(
    event.from === 'focus'
      ? `专注完成，进入${MODE_LABELS[event.to]}${achievementNote}`
      : '休息结束，开始专注',
  );
}

/* ------------------------------------------------------------------ */
/* 收获庆祝                                                            */
/* ------------------------------------------------------------------ */

function celebrateHarvest(event) {
  celebrateUntil = Date.now() + 2400;
  window.clearTimeout(celebrateTimer);
  celebrateTimer = window.setTimeout(() => {
    celebrateUntil = 0;
    renderTimer();
  }, 2400);

  fireConfetti();

  const today = todaySummary(stats);
  queueBanner({
    icon: '🍅',
    title: '收获一颗番茄',
    detail:
      event.to === 'longBreak'
        ? `一轮完成，今天第 ${today.sessions} 颗番茄`
        : `今天第 ${today.sessions} 颗 · 花园累计 ${stats.totalFocusSessions} 颗`,
  });
}

function fireConfetti() {
  if (reduceMotion.matches) return;

  const colors = ['#e04f3a', '#f2a03d', '#3d9a5f', '#e8c547', '#f6b8a8'];
  const pieces = [];
  for (let index = 0; index < 26; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti-piece';
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--delay', `${Math.random() * 0.16}s`);
    piece.style.setProperty('--duration', `${1.05 + Math.random() * 0.75}s`);
    piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 140)}px`);
    piece.style.setProperty('--rotate', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty('--size', `${6 + Math.random() * 6}px`);
    piece.style.setProperty('--color', colors[index % colors.length]);
    pieces.push(piece);
  }

  el.confetti.replaceChildren(...pieces);
  window.setTimeout(() => el.confetti.replaceChildren(), 2400);
}

function queueBanner({ icon, title, detail }) {
  bannerQueue.push({ icon, title, detail });
  if (!bannerTimer) showNextBanner();
}

function showNextBanner() {
  const next = bannerQueue.shift();
  if (!next) {
    el.harvestBanner.classList.remove('is-visible');
    bannerTimer = null;
    return;
  }

  el.harvestIcon.textContent = next.icon ?? '🍅';
  el.harvestTitle.textContent = next.title;
  el.harvestDetail.textContent = next.detail ?? '';
  el.harvestDetail.hidden = !next.detail;
  el.harvestBanner.classList.add('is-visible');

  bannerTimer = window.setTimeout(() => {
    el.harvestBanner.classList.remove('is-visible');
    bannerTimer = window.setTimeout(showNextBanner, 260);
  }, 2600);
}

/* ------------------------------------------------------------------ */
/* 声音与通知                                                          */
/* ------------------------------------------------------------------ */

function unlockAudio() {
  if (!settings.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch {
    audioContext = null;
  }
}

function playChime() {
  if (!settings.sound) return;
  unlockAudio();
  if (!audioContext) return;

  const start = audioContext.currentTime;
  const notes = [
    { frequency: 660, offset: 0 },
    { frequency: 880, offset: 0.16 },
    { frequency: 990, offset: 0.32 },
  ];

  for (const { frequency, offset } of notes) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.28);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.3);
  }
}

function requestNotificationPermission() {
  if (!settings.notifications || !('Notification' in window)) return;
  if (notificationPrompted) return;
  notificationPrompted = true;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function notify(title, body) {
  if (!settings.notifications || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: 'pomodoro', silent: true });
  } catch {
    /* 某些浏览器禁止直接构造通知，忽略即可 */
  }
}

/* ------------------------------------------------------------------ */
/* 任务                                                                */
/* ------------------------------------------------------------------ */

function renderTasks() {
  el.taskList.replaceChildren();
  el.taskEmpty.hidden = tasks.items.length > 0;

  for (const task of tasks.items) {
    const item = document.createElement('li');
    item.className = 'task';
    item.dataset.id = task.id;
    if (task.id === tasks.activeId) item.classList.add('is-active');
    if (task.done) item.classList.add('is-done');

    const doneInput = document.createElement('input');
    doneInput.type = 'checkbox';
    doneInput.className = 'task-check';
    doneInput.checked = task.done;
    doneInput.dataset.action = 'toggle-done';
    doneInput.setAttribute(
      'aria-label',
      task.done ? `将「${task.title}」标记为未完成` : `完成「${task.title}」`,
    );
    doneInput.title = task.done ? '标记为未完成' : '标记为完成';

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'task-select';
    selectButton.dataset.action = 'select';
    selectButton.setAttribute('aria-pressed', String(task.id === tasks.activeId));

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

    const meta = document.createElement('span');
    meta.className = 'task-meta';
    meta.textContent = `${task.sessions}/${task.estimate} 番茄`;

    selectButton.append(title, meta);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'task-delete icon-btn';
    removeButton.dataset.action = 'delete';
    removeButton.setAttribute('aria-label', `删除任务「${task.title}」`);
    removeButton.title = '删除任务';
    removeButton.textContent = '×';

    item.append(doneInput, selectButton, removeButton);
    el.taskList.append(item);
  }

  const doneCount = tasks.items.filter((task) => task.done).length;
  el.taskSummary.textContent = `${doneCount}/${tasks.items.length} 已完成`;
}

function addTask(event) {
  event.preventDefault();
  const title = el.taskTitle.value.trim().slice(0, 80);
  if (!title) {
    el.taskTitle.focus();
    return;
  }

  const estimate = clampInteger(el.taskEstimate.value, 1, 20, 1);
  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  tasks.items.push({ id, title, estimate, sessions: 0, done: false });
  if (!tasks.activeId) tasks.activeId = id;
  persistTasks();
  renderTasks();

  el.taskForm.reset();
  el.taskEstimate.value = '1';
  el.taskTitle.focus();
  announce(`已添加任务：${title}`);
}

function handleTaskListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = button.closest('li[data-id]');
  if (!item) return;
  const task = tasks.items.find((candidate) => candidate.id === item.dataset.id);
  if (!task) return;

  if (button.dataset.action === 'select') {
    tasks.activeId = task.id;
    if (task.done) {
      task.done = false;
      announce(`继续任务：${task.title}`);
    } else {
      announce(`当前专注任务：${task.title}`);
    }
    persistTasks();
    renderTasks();
  } else if (button.dataset.action === 'delete') {
    tasks.items = tasks.items.filter((candidate) => candidate.id !== task.id);
    if (tasks.activeId === task.id) {
      tasks.activeId = tasks.items.find((candidate) => !candidate.done)?.id ?? null;
    }
    persistTasks();
    renderTasks();
    announce(`已删除任务：${task.title}`);
  }
}

function handleTaskListChange(event) {
  const input = event.target.closest('input[data-action="toggle-done"]');
  if (!input) return;
  const item = input.closest('li[data-id]');
  if (!item) return;
  const task = tasks.items.find((candidate) => candidate.id === item.dataset.id);
  if (!task) return;

  task.done = input.checked;
  if (task.done && tasks.activeId === task.id) {
    tasks.activeId = tasks.items.find((candidate) => !candidate.done)?.id ?? null;
  }
  persistTasks();
  renderTasks();
  announce(task.done ? `已完成任务：${task.title}` : `重新打开任务：${task.title}`);
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

function renderStats() {
  const today = todaySummary(stats);
  el.todaySessions.textContent = String(today.sessions);
  el.todayMinutes.textContent = String(today.minutes);
  el.statsTotal.textContent = `累计 ${stats.totalFocusSessions} 个番茄`;

  const week = lastDays(stats, 7);
  const max = Math.max(1, ...week.map((day) => day.sessions));
  const todayKey = week.at(-1)?.key ?? '';
  const columns = [];

  for (const day of week) {
    const column = document.createElement('div');
    column.className = 'chart-col';
    if (day.key === todayKey) column.classList.add('is-today');

    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = day.sessions > 0 ? String(day.sessions) : '';

    const track = document.createElement('div');
    track.className = 'chart-track';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height =
      day.sessions > 0 ? `${Math.max(12, Math.round((day.sessions / max) * 100))}%` : '0';
    track.append(bar);

    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent =
      day.key === todayKey ? '今天' : `周${WEEKDAY_LABELS[day.date.getDay()]}`;

    column.append(value, track, label);
    columns.push(column);
  }

  el.weekChart.replaceChildren(...columns);
  el.weekChart.setAttribute(
    'aria-label',
    `最近 7 天完成的番茄数：${week.map((day) => day.sessions).join('、')}`,
  );
}

/* ------------------------------------------------------------------ */
/* 花园与成就                                                          */
/* ------------------------------------------------------------------ */

function renderGarden() {
  const summary = gardenSummary(stats.totalFocusSessions);
  const today = todaySummary(stats);
  const isNew = summary.total > lastGardenTotal;
  lastGardenTotal = summary.total;

  const plants = summary.plants.map((plant, index) => {
    const item = document.createElement('span');
    item.className = 'plant';
    item.style.setProperty('--tilt', `${((plant.index % 5) - 2) * 1.8}deg`);
    if (isNew && index === summary.plants.length - 1) item.classList.add('is-new');
    item.append(plantSvg(plant.kind));
    return item;
  });

  if (plants.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'garden-empty';
    empty.textContent = '完成一次专注，这里就会长出第一颗番茄。';
    el.garden.replaceChildren(empty);
    el.gardenMeta.textContent = '累计 0 颗番茄';
    el.garden.setAttribute('aria-label', '小花园里还没有番茄');
  } else {
    el.garden.replaceChildren(...plants);
    el.gardenMeta.textContent = `累计 ${summary.total} 颗 · 今天 ${today.sessions} 颗`;
    const hiddenNote = summary.hidden > 0 ? `，更早的 ${summary.hidden} 颗已经收好` : '';
    el.garden.setAttribute(
      'aria-label',
      `小花园：累计 ${summary.total} 颗番茄，今天收获 ${today.sessions} 颗${hiddenNote}`,
    );
  }

  const snapshot = statsSnapshot(stats);
  if (snapshot.currentStreak >= 2) {
    el.streakChip.hidden = false;
    el.streakChip.textContent = `🔥 连续 ${snapshot.currentStreak} 天`;
    el.streakChip.title = `最长连续专注 ${snapshot.longestStreak} 天`;
  } else if (snapshot.longestStreak >= 2) {
    el.streakChip.hidden = false;
    el.streakChip.textContent = `🔥 最长连续 ${snapshot.longestStreak} 天`;
    el.streakChip.title = '今天完成一颗番茄，就能开启新的连击';
  } else {
    el.streakChip.hidden = true;
  }
}

function renderBadges({ announce = false } = {}) {
  const statuses = achievementStatus(stats);
  const fresh = statuses.filter((item) => item.unlocked && !delight.seen.includes(item.id));

  if (fresh.length > 0) {
    delight.seen = [...delight.seen, ...fresh.map((item) => item.id)];
    persistDelight();
  }

  const unlockedCount = statuses.filter((item) => item.unlocked).length;
  el.badgeMeta.textContent = `${unlockedCount}/${statuses.length}`;

  const nodes = statuses.map((item) => {
    const badge = document.createElement('li');
    badge.className = item.unlocked ? 'badge is-unlocked' : 'badge';
    badge.title = item.unlocked
      ? `${item.title}：${item.hint}`
      : `${item.title}：${item.hint}（${item.value}/${item.target}）`;

    const icon = document.createElement('span');
    icon.className = 'badge-icon';
    icon.textContent = item.icon;
    icon.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('span');
    copy.className = 'badge-copy';

    const name = document.createElement('span');
    name.className = 'badge-name';
    name.textContent = item.title;

    const progress = document.createElement('span');
    progress.className = 'badge-progress';
    progress.textContent = item.unlocked ? '已解锁' : `${item.value}/${item.target}`;

    copy.append(name, progress);
    badge.append(icon, copy);
    if (fresh.some((entry) => entry.id === item.id)) badge.classList.add('is-new');
    return badge;
  });

  el.badgeList.replaceChildren(...nodes);

  if (announce) {
    for (const item of fresh) {
      queueBanner({ icon: item.icon, title: `解锁成就：${item.title}`, detail: item.hint });
    }
  }

  return { statuses, fresh };
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function fillSettingsForm(source) {
  const form = el.settingsForm.elements;
  form.focusMinutes.value = source.focusMinutes;
  form.shortBreakMinutes.value = source.shortBreakMinutes;
  form.longBreakMinutes.value = source.longBreakMinutes;
  form.longBreakInterval.value = source.longBreakInterval;
  form.autoStartBreaks.checked = source.autoStartBreaks;
  form.autoStartFocus.checked = source.autoStartFocus;
  form.sound.checked = source.sound;
  form.notifications.checked = source.notifications;
  form.theme.value = source.theme;
}

function saveSettings(event) {
  event.preventDefault();
  const form = el.settingsForm.elements;
  const previous = settings;

  settings = normalizeSettings({
    focusMinutes: Number(form.focusMinutes.value),
    shortBreakMinutes: Number(form.shortBreakMinutes.value),
    longBreakMinutes: Number(form.longBreakMinutes.value),
    longBreakInterval: Number(form.longBreakInterval.value),
    autoStartBreaks: form.autoStartBreaks.checked,
    autoStartFocus: form.autoStartFocus.checked,
    sound: form.sound.checked,
    notifications: form.notifications.checked,
    theme: form.theme.value,
  });

  persistSettings();
  engine.changeSettings(settings);
  applyTheme();
  renderAll();
  el.settingsDialog.close();

  const durationsChanged =
    previous.focusMinutes !== settings.focusMinutes ||
    previous.shortBreakMinutes !== settings.shortBreakMinutes ||
    previous.longBreakMinutes !== settings.longBreakMinutes;
  announce(
    durationsChanged && engine.status === 'running'
      ? '设置已保存，新的时长将在下一阶段生效'
      : '设置已保存',
  );
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function renderAll({ announceAchievements = false } = {}) {
  renderTimer();
  renderTasks();
  renderStats();
  renderGarden();
  const result = renderBadges({ announce: announceAchievements });
  updateThemeButton();
  return result;
}

function init() {
  el.ringValue.style.strokeDasharray = `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`;
  setRingFraction(1);

  renderThemeOptions();
  fillSettingsForm(settings);
  applyTheme();
  renderAll();

  el.startBtn.addEventListener('click', toggleTimer);
  el.resetBtn.addEventListener('click', resetTimer);
  el.skipBtn.addEventListener('click', skipTimer);

  for (const tab of el.modeTabs) {
    tab.addEventListener('click', () => {
      if (!engine.select(tab.dataset.mode)) return;
      announce(`已切换到${MODE_LABELS[engine.mode]}`);
      renderTimer();
    });
  }

  el.themeToggle.addEventListener('click', () => {
    settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
    persistSettings();
    applyTheme();
    announce(`已切换到${settings.theme === 'dark' ? '深色' : '浅色'}主题`);
  });

  el.themeMenuToggle.addEventListener('click', () => {
    setThemeMenuOpen(el.themeMenu.hidden);
  });

  el.themeOptions.addEventListener('click', (event) => {
    const option = event.target.closest('.theme-option');
    if (option) chooseTheme(option.dataset.theme);
  });

  el.themeMenu.addEventListener('keydown', (event) => {
    const options = [...el.themeOptions.querySelectorAll('.theme-option')];
    const current = options.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      setThemeMenuOpen(false);
      el.themeMenuToggle.focus();
      return;
    }

    if (event.key === 'Tab') {
      setThemeMenuOpen(false);
      el.themeMenuToggle.focus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[(current + step + options.length) % options.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      options[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      options.at(-1)?.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (el.themeMenu.hidden) return;
    if (el.themeMenu.contains(event.target) || el.themeMenuToggle.contains(event.target)) {
      return;
    }
    setThemeMenuOpen(false);
  });

  darkQuery.addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme();
  });

  el.openSettings.addEventListener('click', () => {
    fillSettingsForm(settings);
    el.settingsDialog.showModal();
  });

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => el.settingsDialog.close());
  }

  el.settingsDialog.addEventListener('click', (event) => {
    if (event.target === el.settingsDialog) el.settingsDialog.close();
  });

  el.settingsForm.addEventListener('submit', saveSettings);
  el.resetSettings.addEventListener('click', () => {
    fillSettingsForm(DEFAULT_SETTINGS);
    announce('已填入默认设置，点击保存后生效');
  });

  el.taskForm.addEventListener('submit', addTask);
  el.taskList.addEventListener('click', handleTaskListClick);
  el.taskList.addEventListener('change', handleTaskListChange);

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (el.settingsDialog.open) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        'input, textarea, select, button, a, [contenteditable="true"]',
      )
    ) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      toggleTimer();
    } else if (event.key === 'r' || event.key === 'R') {
      resetTimer();
    } else if (event.key === 's' || event.key === 'S') {
      skipTimer();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tickLoop();
  });

  window.setInterval(tickLoop, 200);
}

init();
