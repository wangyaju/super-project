import { PomodoroEngine, MODE_LABELS, formatClock } from './timer.js';
import {
  DEFAULT_SETTINGS,
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

const STORAGE_KEYS = {
  settings: 'pomodoro.settings.v1',
  stats: 'pomodoro.stats.v1',
  tasks: 'pomodoro.tasks.v1',
};

const RING_RADIUS = 103;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** @type {Record<string, HTMLElement>} */
const el = {
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
  liveStatus: document.querySelector('#liveStatus'),
};

const storage = getStorage();
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

let settings = normalizeSettings(readJSON(storage, STORAGE_KEYS.settings, DEFAULT_SETTINGS));
let stats = normalizeStats(readJSON(storage, STORAGE_KEYS.stats, null));
let tasks = normalizeTasks(readJSON(storage, STORAGE_KEYS.tasks, null));
const engine = new PomodoroEngine({
  settings,
  totalFocusSessions: stats.totalFocusSessions,
});

let announceTimer = null;
let audioContext = null;
let notificationPrompted = false;

const STATUS_HINTS = {
  focus: {
    idle: '准备好后，开始第一颗番茄',
    running: '保持专注，一次只做一件事',
    paused: '已暂停，按空格继续',
  },
  shortBreak: {
    idle: '起来走走，喝口水',
    running: '离开屏幕，让眼睛休息一下',
    paused: '休息暂停中，按空格继续',
  },
  longBreak: {
    idle: '完成一轮，好好放松',
    running: '这一轮结束了，尽情休息',
    paused: '长休息暂停中，按空格继续',
  },
};

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

/* ------------------------------------------------------------------ */
/* 主题                                                                */
/* ------------------------------------------------------------------ */

function resolvedTheme() {
  if (settings.theme === 'system') return darkQuery.matches ? 'dark' : 'light';
  return settings.theme;
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#171412' : '#f6f1e9';
  updateThemeButton();
}

function updateThemeButton() {
  const isDark = resolvedTheme() === 'dark';
  const label = isDark ? '切换到浅色主题' : '切换到深色主题';
  el.themeToggle.setAttribute('aria-label', label);
  el.themeToggle.setAttribute('title', label);
  el.themeToggle.setAttribute('aria-pressed', String(isDark));
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

  el.phaseHint.textContent =
    STATUS_HINTS[engine.mode][engine.status] ?? STATUS_HINTS[engine.mode].idle;

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

  const dots = [];
  for (let index = 0; index < interval; index += 1) {
    const dot = document.createElement('span');
    dot.className = index < filled ? 'cycle-dot is-done' : 'cycle-dot';
    dot.setAttribute('aria-hidden', 'true');
    dots.push(dot);
  }
  el.cycleDots.replaceChildren(...dots);
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
  }

  const title = event.from === 'focus' ? '专注完成' : '休息结束';
  const body =
    event.from === 'focus'
      ? `${MODE_LABELS[event.to]} ${modeMinutes(event.to)} 分钟，起来活动一下。`
      : `开始下一个番茄，保持节奏。`;

  playChime();
  notify(title, body);
  announce(
    event.from === 'focus'
      ? `专注完成，进入${MODE_LABELS[event.to]}`
      : '休息结束，开始专注',
  );

  renderAll();
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

function renderAll() {
  renderTimer();
  renderTasks();
  renderStats();
  updateThemeButton();
}

function init() {
  el.ringValue.style.strokeDasharray = `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`;
  setRingFraction(1);

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
