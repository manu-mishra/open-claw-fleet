import { createApi } from './js/api.js';
import { attachAgentSearch } from './js/agent-search.js';
import { createTaskBoard } from './js/task-board.js';
import { renderTaskDetails } from './js/task-details.js';
import { escapeHtml, formatTimestamp } from './js/helpers.js';

const app = document.getElementById('app');
const loginModal = document.getElementById('loginModal');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

const createTaskModal = document.getElementById('createTaskModal');
const openCreateTaskModalButton = document.getElementById('openCreateTaskModalButton');
const cancelCreateTaskButton = document.getElementById('cancelCreateTaskButton');

const refreshButton = document.getElementById('refreshButton');
const logoutButton = document.getElementById('logoutButton');
const currentUserNode = document.getElementById('currentUser');
const realtimeStatusNode = document.getElementById('realtimeStatus');

const metricsNode = document.getElementById('metrics');
const agentsListNode = document.getElementById('agentsList');
const agentCountNode = document.getElementById('agentCount');
const boardNode = document.getElementById('board');
const selectedTaskNode = document.getElementById('selectedTask');
const detailsPanelNode = selectedTaskNode?.closest('.details-panel');
const commentForm = document.getElementById('commentForm');
const commentMessage = document.getElementById('commentMessage');
const activityFeed = document.getElementById('activityFeed');

const createTaskForm = document.getElementById('createTaskForm');
const taskTitleInput = document.getElementById('taskTitle');
const taskAssigneeInput = document.getElementById('taskAssignee');
const taskDeliverableInput = document.getElementById('taskDeliverable');
const taskPriorityInput = document.getElementById('taskPriority');
const createTaskStatus = document.getElementById('createTaskStatus');
const createTaskAssigneeResults = document.getElementById('createTaskAssigneeResults');
const agentSuggestionsNode = document.getElementById('agentSuggestions');

const broadcastForm = document.getElementById('broadcastForm');
const broadcastRoomInput = document.getElementById('broadcastRoom');
const broadcastMessageInput = document.getElementById('broadcastMessage');
const broadcastStatus = document.getElementById('broadcastStatus');

const taskCardTemplate = document.getElementById('taskCardTemplate');
const primaryTabsNode = document.getElementById('primaryTabs');
const tabLinks = Array.from(document.querySelectorAll('[data-tab-link]'));
const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

const DEFAULT_TAB_ID = 'tasks';
const ACTIVE_TAB_STORAGE_KEY = 'command-center.active-tab';
const TAB_PATHS = {
  tasks: '/tasks',
  agents: '/agents',
  activities: '/activities',
};

const STATUS_LABELS = {
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};

const state = {
  dashboard: null,
  selectedTaskId: null,
  activeTabId: DEFAULT_TAB_ID,
  eventSource: null,
  reconnectTimer: null,
  loadingDashboard: false,
  pendingReload: false,
  createAssigneeSearchCleanup: null,
  selectedAssigneeSearchCleanup: null,
};

const api = createApi({
  onUnauthorized: () => setAuthenticated(false),
});

function normalizeTaskId(taskId) {
  if (taskId === null || taskId === undefined) {
    return '';
  }
  return String(taskId).trim();
}

function taskIdMatches(candidateTaskId, selectedTaskId) {
  return normalizeTaskId(candidateTaskId) === normalizeTaskId(selectedTaskId);
}

function normalizePathname(pathname) {
  if (!pathname) {
    return '/';
  }
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

function tabIdFromPathname(pathname) {
  const normalized = normalizePathname(pathname);
  if (normalized === '/tasks' || normalized === '/dashboard' || normalized === '/') {
    return 'tasks';
  }
  if (normalized === '/agents') {
    return 'agents';
  }
  if (normalized === '/comms') {
    return 'activities';
  }
  if (normalized === '/activities') {
    return 'activities';
  }
  return null;
}

function isValidTabId(tabId) {
  return tabLinks.some((link) => link instanceof HTMLElement && link.dataset.tab === tabId);
}

function setActiveTab(tabId, options = {}) {
  const { persist = true, updatePath = true, replaceHistory = false } = options;
  const nextTabId = isValidTabId(tabId) ? tabId : DEFAULT_TAB_ID;
  state.activeTabId = nextTabId;

  for (const link of tabLinks) {
    if (!(link instanceof HTMLElement)) {
      continue;
    }
    const active = link.dataset.tab === nextTabId;
    link.classList.toggle('is-active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }

  for (const panel of tabPanels) {
    if (!(panel instanceof HTMLElement)) {
      continue;
    }
    const active = panel.dataset.tabPanel === nextTabId;
    panel.classList.toggle('is-active', active);
    if (active) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', 'true');
    }
  }

  if (updatePath) {
    const nextPath = TAB_PATHS[nextTabId] ?? TAB_PATHS[DEFAULT_TAB_ID];
    const currentPath = normalizePathname(window.location.pathname);
    if (nextPath && currentPath !== nextPath) {
      const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
      if (replaceHistory) {
        window.history.replaceState(null, '', nextUrl);
      } else {
        window.history.pushState(null, '', nextUrl);
      }
    }
  }

  if (!persist) {
    return;
  }

  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, nextTabId);
  } catch {
    // Ignore storage failures.
  }
}

function initializeTabs() {
  if (!(primaryTabsNode instanceof HTMLElement)) {
    return;
  }

  primaryTabsNode.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest('[data-tab-link]');
    if (!(link instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();

    const tabId = link.dataset.tab ?? DEFAULT_TAB_ID;
    setActiveTab(tabId, { updatePath: true });
  });

  let initialTabId = tabIdFromPathname(window.location.pathname) ?? DEFAULT_TAB_ID;
  if (!isValidTabId(initialTabId)) {
    initialTabId = DEFAULT_TAB_ID;
  }

  try {
    const savedTabId = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (!tabIdFromPathname(window.location.pathname) && savedTabId && isValidTabId(savedTabId)) {
      initialTabId = savedTabId;
    }
  } catch {
    // Ignore storage failures.
  }

  setActiveTab(initialTabId, { persist: false, updatePath: false });

  window.addEventListener('popstate', () => {
    const tabId = tabIdFromPathname(window.location.pathname) ?? DEFAULT_TAB_ID;
    setActiveTab(tabId, { persist: false, updatePath: false });
  });
}

function revealTaskDetailsPanel() {
  if (!(detailsPanelNode instanceof HTMLElement)) {
    return;
  }

  const rect = detailsPanelNode.getBoundingClientRect();
  const belowFold = rect.top > window.innerHeight - 72;
  const aboveFold = rect.bottom < 80;

  if (belowFold || aboveFold) {
    detailsPanelNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const taskBoard = createTaskBoard({
  boardNode,
  taskCardTemplate,
  statusLabels: STATUS_LABELS,
  formatTimestamp,
  onTaskSelect: (taskId) => {
    selectTask(taskId, { reveal: true });
  },
  onTaskMove: async (taskId, nextStatus) => {
    try {
      await api(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      await loadDashboard();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      await loadDashboard();
    }
  },
});

function selectTask(taskId, options = {}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId || !state.dashboard) {
    return;
  }
  if (!state.dashboard.tasks.some((task) => taskIdMatches(task.id, normalizedTaskId))) {
    return;
  }

  state.selectedTaskId = normalizedTaskId;
  writeTaskHash(normalizedTaskId);
  renderSelectedTask();
  taskBoard.highlightSelected(normalizedTaskId);

  if (options.reveal) {
    setActiveTab(DEFAULT_TAB_ID, { persist: false, updatePath: true });
    revealTaskDetailsPanel();
  }
}

// Fallback selection path for browsers where draggable cards swallow click handlers.
boardNode.addEventListener(
  'click',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const card = target.closest('.task-card');
    if (!card) {
      return;
    }
    const taskId = card.getAttribute('data-task-id') || '';
    if (!taskId) {
      return;
    }
    selectTask(taskId, { reveal: true });
  },
  true,
);

boardNode.addEventListener(
  'pointerup',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const card = target.closest('.task-card');
    if (!card) {
      return;
    }
    const taskId = card.getAttribute('data-task-id') || '';
    if (!taskId) {
      return;
    }
    selectTask(taskId, { reveal: true });
  },
  true,
);

boardNode.addEventListener(
  'pointerdown',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const card = target.closest('.task-card');
    if (!card) {
      return;
    }
    const taskId = card.getAttribute('data-task-id') || '';
    if (!taskId) {
      return;
    }
    selectTask(taskId, { reveal: true });
  },
  true,
);

boardNode.addEventListener(
  'mousedown',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const card = target.closest('.task-card');
    if (!card) {
      return;
    }
    const taskId = card.getAttribute('data-task-id') || '';
    if (!taskId) {
      return;
    }
    selectTask(taskId, { reveal: true });
  },
  true,
);

function readTaskIdFromHash() {
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw) {
    return null;
  }

  const params = new URLSearchParams(raw);
  const taskId = params.get('task');
  if (!taskId) {
    return null;
  }
  return taskId.trim() || null;
}

function writeTaskHash(taskId) {
  if (!taskId) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return;
  }
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  params.set('task', taskId);
  window.location.hash = params.toString();
}

function setRealtimeStatus(connected) {
  realtimeStatusNode.textContent = connected ? 'Realtime: live' : 'Realtime: reconnecting';
  realtimeStatusNode.classList.toggle('offline', !connected);
}

function closeCreateTaskModal() {
  createTaskModal.classList.remove('visible');
  createTaskModal.setAttribute('aria-hidden', 'true');
  createTaskStatus.textContent = '';
}

function openCreateTaskModal() {
  createTaskModal.classList.add('visible');
  createTaskModal.setAttribute('aria-hidden', 'false');
  taskTitleInput.focus();
}

function clearCreateTaskForm() {
  taskTitleInput.value = '';
  taskAssigneeInput.value = '';
  taskDeliverableInput.value = '';
  taskPriorityInput.value = 'medium';
}

function setAuthenticated(isAuthenticated) {
  if (isAuthenticated) {
    loginModal.classList.remove('visible');
    app.classList.remove('hidden');
    connectRealtime();
    return;
  }

  app.classList.add('hidden');
  loginModal.classList.add('visible');
  closeCreateTaskModal();
  state.dashboard = null;
  state.selectedTaskId = null;
  disconnectRealtime();
}

function connectRealtime() {
  if (state.eventSource) {
    return;
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  const source = new EventSource('/api/events');
  state.eventSource = source;

  source.addEventListener('open', () => {
    setRealtimeStatus(true);
  });

  source.addEventListener('connected', () => {
    setRealtimeStatus(true);
  });

  source.addEventListener('keepalive', () => {
    setRealtimeStatus(true);
  });

  source.addEventListener('dashboard_update', () => {
    loadDashboard().catch(() => {
      // Ignore live reload errors and keep current view.
    });
  });

  source.onerror = () => {
    setRealtimeStatus(false);
    source.close();
    state.eventSource = null;

    if (!app.classList.contains('hidden') && !state.reconnectTimer) {
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connectRealtime();
      }, 2500);
    }
  };
}

function disconnectRealtime() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  setRealtimeStatus(false);
}

async function loadDashboard() {
  if (state.loadingDashboard) {
    state.pendingReload = true;
    return;
  }

  state.loadingDashboard = true;

  try {
    const dashboard = await api('/api/dashboard');
    state.dashboard = dashboard;

    const hashTaskId = readTaskIdFromHash();
    if (hashTaskId && dashboard.tasks.some((task) => taskIdMatches(task.id, hashTaskId))) {
      state.selectedTaskId = normalizeTaskId(hashTaskId);
    }

    if (state.selectedTaskId && !dashboard.tasks.some((task) => taskIdMatches(task.id, state.selectedTaskId))) {
      state.selectedTaskId = null;
      writeTaskHash(null);
    }

    render();
  } finally {
    state.loadingDashboard = false;
    if (state.pendingReload) {
      state.pendingReload = false;
      await loadDashboard();
    }
  }
}

function render() {
  if (!state.dashboard) {
    return;
  }

  renderTopline(state.dashboard);
  renderMetrics(state.dashboard.totals);
  renderAgents(state.dashboard.agents);
  taskBoard.render(state.dashboard.statuses, state.dashboard.tasks, state.selectedTaskId);
  renderSelectedTask();
  renderActivity(state.dashboard.activity);
}

function renderTopline(dashboard) {
  currentUserNode.textContent = `Signed in as ${dashboard.currentUser}`;
}

function renderMetrics(totals) {
  const cards = [
    ['Tasks', totals.totalTasks],
    ['In Progress', totals.inProgress],
    ['Review', totals.review],
    ['Done', totals.completed],
    ['Active Agents', totals.activeAgents],
  ];

  metricsNode.innerHTML = '';
  for (const [label, value] of cards) {
    const card = document.createElement('article');
    card.className = 'metric';
    card.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    metricsNode.appendChild(card);
  }
}

function renderAgents(agents) {
  agentsListNode.innerHTML = '';
  agentSuggestionsNode.innerHTML = '';
  agentCountNode.textContent = String(agents.length);

  for (const agent of agents) {
    const row = document.createElement('article');
    row.className = 'agent-row';
    row.innerHTML = `
      <strong>${escapeHtml(agent.name)}</strong>
      <span>${escapeHtml(agent.title)} · ${escapeHtml(agent.department)}</span>
      <div><span class="status status-${agent.status}">${agent.status}</span></div>
      <span>${escapeHtml(agent.matrixId)}</span>
    `;
    agentsListNode.appendChild(row);

    const option = document.createElement('option');
    option.value = agent.matrixId;
    option.label = `${agent.name} (${agent.title})`;
    agentSuggestionsNode.appendChild(option);
  }

  state.createAssigneeSearchCleanup?.();
  state.createAssigneeSearchCleanup = attachAgentSearch({
    inputNode: taskAssigneeInput,
    resultsNode: createTaskAssigneeResults,
    agents,
  });
}

function wireSelectedAssigneeSearch(inputNode, resultsNode) {
  state.selectedAssigneeSearchCleanup?.();
  state.selectedAssigneeSearchCleanup = attachAgentSearch({
    inputNode,
    resultsNode,
    agents: state.dashboard?.agents ?? [],
  });
}

function renderSelectedTask() {
  const task = state.dashboard?.tasks.find((entry) => taskIdMatches(entry.id, state.selectedTaskId)) ?? null;

  try {
    renderTaskDetails({
      selectedTaskNode,
      commentForm,
      task,
      priorities: state.dashboard?.priorities ?? [],
      statuses: state.dashboard?.statuses ?? [],
      statusLabels: STATUS_LABELS,
      activityEvents: state.dashboard?.activity ?? [],
      formatTimestamp,
      escapeHtml,
      wireAssigneeSearch: wireSelectedAssigneeSearch,
      onSave: async (payload) => {
        await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: payload });
        await loadDashboard();
      },
    });
  } catch (error) {
    selectedTaskNode.classList.remove('empty');
    selectedTaskNode.innerHTML = `<p class="task-desc">Task detail render failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    commentForm.classList.add('hidden');
  }

  if (!task) {
    state.selectedAssigneeSearchCleanup?.();
    state.selectedAssigneeSearchCleanup = null;
  }
}

function renderActivity(events) {
  activityFeed.innerHTML = '';

  const recent = events.slice(0, 60);
  for (const event of recent) {
    const row = document.createElement('article');
    row.className = 'activity-item';
    row.innerHTML = `
      <strong>${escapeHtml(event.actorMatrixId)}</strong>
      <p>${escapeHtml(event.message)}</p>
      <time>${formatTimestamp(event.createdAt)}</time>
    `;
    activityFeed.appendChild(row);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  const matrixId = document.getElementById('matrixId').value.trim();
  const password = document.getElementById('matrixPassword').value;

  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: {
        matrixId,
        password,
      },
    });

    setAuthenticated(true);
    await loadDashboard();
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : String(error);
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout errors.
  }
  setAuthenticated(false);
});

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  try {
    await loadDashboard();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  } finally {
    refreshButton.disabled = false;
  }
});

openCreateTaskModalButton.addEventListener('click', () => {
  openCreateTaskModal();
});

cancelCreateTaskButton.addEventListener('click', () => {
  closeCreateTaskModal();
});

createTaskModal.addEventListener('click', (event) => {
  if (event.target === createTaskModal) {
    closeCreateTaskModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && createTaskModal.classList.contains('visible')) {
    closeCreateTaskModal();
  }
});

createTaskForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = taskTitleInput.value.trim();
  const deliverable = taskDeliverableInput.value.trim();
  if (!title || !deliverable) {
    createTaskStatus.textContent = 'Title and deliverable are required.';
    return;
  }

  const payload = {
    title,
    deliverable,
    priority: taskPriorityInput.value,
    assigneeMatrixId: taskAssigneeInput.value.trim() || null,
  };

  const createButton = document.getElementById('submitCreateTaskButton');

  try {
    if (createButton) {
      createButton.disabled = true;
    }
    createTaskStatus.textContent = 'Creating task...';

    const createdTask = await api('/api/tasks', {
      method: 'POST',
      body: payload,
    });

    const createdTaskId = normalizeTaskId(createdTask.id);
    state.selectedTaskId = createdTaskId;
    writeTaskHash(createdTaskId);
    clearCreateTaskForm();
    createTaskStatus.textContent = 'Task created.';
    closeCreateTaskModal();
    await loadDashboard();
  } catch (error) {
    createTaskStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (createButton) {
      createButton.disabled = false;
    }
  }
});

commentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedTaskId) {
    alert('Select a task card first.');
    return;
  }

  const message = commentMessage.value.trim();
  if (!message) {
    alert('Comment message is required.');
    return;
  }

  try {
    await api(`/api/tasks/${state.selectedTaskId}/comments`, {
      method: 'POST',
      body: { message },
    });
    commentMessage.value = '';
    await loadDashboard();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  }
});

broadcastForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const message = broadcastMessageInput.value.trim();
  if (!message) {
    return;
  }

  broadcastStatus.textContent = 'Sending...';
  try {
    await api('/api/matrix/broadcast', {
      method: 'POST',
      body: {
        message,
        roomAlias: broadcastRoomInput.value.trim(),
      },
    });

    broadcastMessageInput.value = '';
    broadcastStatus.textContent = 'Broadcast sent.';
    await loadDashboard();
  } catch (error) {
    broadcastStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

window.addEventListener('hashchange', () => {
  if (!state.dashboard) {
    return;
  }
  const hashTaskId = readTaskIdFromHash();
  if (!hashTaskId) {
    return;
  }
  if (!state.dashboard.tasks.some((task) => taskIdMatches(task.id, hashTaskId))) {
    return;
  }
  state.selectedTaskId = normalizeTaskId(hashTaskId);
  setActiveTab(DEFAULT_TAB_ID, { persist: false, updatePath: true });
  renderSelectedTask();
  taskBoard.highlightSelected(state.selectedTaskId);
});

(async function init() {
  initializeTabs();
  try {
    await api('/api/auth/me');
    setAuthenticated(true);
    await loadDashboard();
  } catch {
    setAuthenticated(false);
  }
})();
