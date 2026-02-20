import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number.parseInt(process.env.PORT ?? '8090', 10);
const DATA_DIR = process.env.DATA_DIR ?? '/data/command-center';
const STATE_FILE = join(DATA_DIR, 'state.json');
const ORG_FILE_PATH = process.env.ORG_FILE_PATH ?? '/data/workspaces/org.json';
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT ?? dirname(ORG_FILE_PATH);
const MATRIX_HOMESERVER = process.env.MATRIX_HOMESERVER ?? 'http://conduit:6167';
const MATRIX_DOMAIN = process.env.MATRIX_DOMAIN ?? 'anycompany.corp';
const COMMAND_CENTER_PUBLIC_URL = (process.env.COMMAND_CENTER_PUBLIC_URL ?? 'http://localhost:8090').replace(/\/+$/, '');
const COMMAND_CENTER_API_TOKEN = process.env.COMMAND_CENTER_API_TOKEN?.trim() ?? '';
const COMMAND_CENTER_API_TOKEN_HEADER = 'x-command-center-token';
const MATRIX_PASSWORD_SEED = (process.env.MATRIX_PASSWORD_SEED ?? process.env.FLEET_SECRET ?? COMMAND_CENTER_API_TOKEN).trim();
const TASK_ASSIGNMENT_BOT_MATRIX_ID = process.env.TASK_ASSIGNMENT_BOT_MATRIX_ID?.trim() ?? '';

const SESSION_COOKIE_NAME = 'ocf_command_center_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ACTIVITY_EVENTS = 1500;
const MAX_PEOPLE_QUERY_LIMIT = 100;
const MAX_TASK_QUERY_LIMIT = 200;

const TASK_STATUSES = ['inbox', 'assigned', 'in_progress', 'review', 'done', 'blocked'] as const;
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

type TaskStatus = (typeof TASK_STATUSES)[number];
type TaskPriority = (typeof TASK_PRIORITIES)[number];

interface TaskComment {
  id: string;
  authorMatrixId: string;
  message: string;
  createdAt: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  creatorMatrixId: string;
  assigneeMatrixId: string | null;
  tags: string[];
  deliverable: string;
  createdAt: string;
  updatedAt: string;
  comments: TaskComment[];
}

interface ActivityEvent {
  id: string;
  type: 'task_created' | 'task_updated' | 'comment_added' | 'broadcast_sent';
  actorMatrixId: string;
  taskId: string | null;
  message: string;
  createdAt: string;
}

interface DashboardState {
  tasks: Task[];
  activity: ActivityEvent[];
}

interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeMatrixId?: string | null;
  tags?: string[];
  deliverable: string;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeMatrixId?: string | null;
  tags?: string[];
  deliverable?: string;
}

interface AgentSummary {
  matrixId: string;
  name: string;
  title: string;
  department: string;
  team: string;
  status: 'working' | 'idle' | 'external';
}

interface UserSession {
  sessionId: string;
  userId: string;
  accessToken: string;
  homeserver: string;
  createdAt: number;
  expiresAt: number;
}

type AuthedRequest = Request & { session: UserSession };

const PEOPLE_ACTIONS = ['search', 'find', 'department', 'team', 'title', 'level', 'manager', 'reports', 'chain', 'list'] as const;
type PeopleAction = (typeof PEOPLE_ACTIONS)[number];

interface OrgPerson {
  name: string;
  title: string;
  level: string;
  department: string;
  team: string | null;
  matrixId: string;
  reportsTo: string | null;
  directReports: string[];
}

interface OrgDepartment {
  name: string;
  vp: string;
  teams: string[];
  headcount: number;
}

interface OrgData {
  departments: OrgDepartment[];
  people: OrgPerson[];
}

class StateStore {
  private state: DashboardState;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {
    this.state = { tasks: [], activity: [] };
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true });

    if (!existsSync(this.filePath)) {
      await this.persist();
      return;
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DashboardState>;

      this.state = {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((task) => this.normalizeTask(task)) : [],
        activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      };
    } catch {
      this.state = { tasks: [], activity: [] };
      await this.persist();
    }
  }

  getSnapshot(): DashboardState {
    const cloned = structuredClone(this.state);
    cloned.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    cloned.activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return cloned;
  }

  createTask(input: CreateTaskInput, actorMatrixId: string): Promise<Task> {
    return this.enqueue(async () => {
      const now = new Date().toISOString();
      const task: Task = {
        id: `task_${Date.now()}_${randomUUID().slice(0, 8)}`,
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        status: 'inbox',
        priority: input.priority ?? 'medium',
        creatorMatrixId: actorMatrixId,
        assigneeMatrixId: normalizeNullableMatrixId(input.assigneeMatrixId ?? null),
        tags: sanitizeTags(input.tags ?? []),
        deliverable: sanitizeRequiredText(input.deliverable, 'deliverable'),
        createdAt: now,
        updatedAt: now,
        comments: [],
      };

      this.state.tasks.push(task);
      this.recordActivity({
        type: 'task_created',
        actorMatrixId,
        taskId: task.id,
        message: `${actorMatrixId} created ${task.id}`,
      });

      return task;
    });
  }

  updateTask(taskId: string, input: UpdateTaskInput, actorMatrixId: string): Promise<Task> {
    return this.enqueue(async () => {
      const task = this.state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const previousStatus = task.status;
      const previousAssignee = task.assigneeMatrixId;
      const previousPriority = task.priority;

      if (typeof input.title === 'string') {
        task.title = input.title.trim();
      }
      if (typeof input.description === 'string') {
        task.description = input.description.trim();
      }
      if (input.status && TASK_STATUSES.includes(input.status)) {
        task.status = input.status;
      }
      if (input.priority && TASK_PRIORITIES.includes(input.priority)) {
        task.priority = input.priority;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'assigneeMatrixId')) {
        task.assigneeMatrixId = normalizeNullableMatrixId(input.assigneeMatrixId ?? null);
      }
      if (Array.isArray(input.tags)) {
        task.tags = sanitizeTags(input.tags);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'deliverable')) {
        task.deliverable = sanitizeRequiredText(input.deliverable ?? '', 'deliverable');
      }

      task.updatedAt = new Date().toISOString();

      const changeSummary = [
        previousStatus !== task.status ? `status ${previousStatus} -> ${task.status}` : null,
        previousPriority !== task.priority ? `priority ${previousPriority} -> ${task.priority}` : null,
        previousAssignee !== task.assigneeMatrixId
          ? `assignee ${previousAssignee ?? 'none'} -> ${task.assigneeMatrixId ?? 'none'}`
          : null,
      ]
        .filter((entry): entry is string => entry !== null)
        .join(', ');

      if (previousStatus !== task.status) {
        task.comments.push({
          id: `comment_${Date.now()}_${randomUUID().slice(0, 8)}`,
          authorMatrixId: actorMatrixId,
          message: `[UPDATE] Status changed: ${previousStatus} -> ${task.status}`,
          createdAt: task.updatedAt,
        });
      }

      this.recordActivity({
        type: 'task_updated',
        actorMatrixId,
        taskId: task.id,
        message: changeSummary.length > 0 ? changeSummary : `${actorMatrixId} updated ${task.id}`,
      });

      return task;
    });
  }

  addComment(taskId: string, message: string, actorMatrixId: string): Promise<Task> {
    return this.enqueue(async () => {
      const task = this.state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const comment: TaskComment = {
        id: `comment_${Date.now()}_${randomUUID().slice(0, 8)}`,
        authorMatrixId: actorMatrixId,
        message: message.trim(),
        createdAt: new Date().toISOString(),
      };

      task.comments.push(comment);
      task.updatedAt = comment.createdAt;

      this.recordActivity({
        type: 'comment_added',
        actorMatrixId,
        taskId: task.id,
        message: `${actorMatrixId} commented on ${task.id}`,
      });

      return task;
    });
  }

  recordBroadcast(actorMatrixId: string, roomAlias: string): Promise<void> {
    return this.enqueue(async () => {
      this.recordActivity({
        type: 'broadcast_sent',
        actorMatrixId,
        taskId: null,
        message: `${actorMatrixId} broadcast to ${roomAlias}`,
      });
    });
  }

  private normalizeTask(input: unknown): Task {
    const candidate = (input ?? {}) as Partial<Task>;
    return {
      id: candidate.id ?? `task_legacy_${Date.now()}_${randomUUID().slice(0, 8)}`,
      title: typeof candidate.title === 'string' && candidate.title.trim().length > 0 ? candidate.title.trim() : 'Untitled Task',
      description: typeof candidate.description === 'string' ? candidate.description : '',
      status: TASK_STATUSES.includes(candidate.status as TaskStatus) ? (candidate.status as TaskStatus) : 'inbox',
      priority: TASK_PRIORITIES.includes(candidate.priority as TaskPriority) ? (candidate.priority as TaskPriority) : 'medium',
      creatorMatrixId: typeof candidate.creatorMatrixId === 'string' ? candidate.creatorMatrixId : '@unknown:anycompany.corp',
      assigneeMatrixId: normalizeNullableMatrixId(candidate.assigneeMatrixId ?? null),
      tags: Array.isArray(candidate.tags) ? sanitizeTags(candidate.tags) : [],
      deliverable:
        typeof candidate.deliverable === 'string' && candidate.deliverable.trim().length > 0
          ? candidate.deliverable.trim()
          : 'Define expected deliverable',
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
      comments: Array.isArray(candidate.comments) ? candidate.comments : [],
    };
  }

  private recordActivity(event: Omit<ActivityEvent, 'id' | 'createdAt'>): void {
    this.state.activity.push({
      id: `event_${Date.now()}_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      ...event,
    });

    if (this.state.activity.length > MAX_ACTIVITY_EVENTS) {
      this.state.activity = this.state.activity.slice(this.state.activity.length - MAX_ACTIVITY_EVENTS);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const chained = this.chain.then(operation, operation);
    this.chain = chained.then(
      async () => {
        await this.persist();
      },
      async () => {
        await this.persist();
      },
    );

    return chained;
  }

  private async persist(): Promise<void> {
    const tempFile = `${this.filePath}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tempFile, this.filePath);
  }
}

class OrgDirectory {
  private cached: OrgData = { departments: [], people: [] };
  private cachedMtimeMs = -1;

  constructor(private readonly orgPath: string) {}

  async getSnapshot(): Promise<OrgData> {
    if (!existsSync(this.orgPath)) {
      this.cached = { departments: [], people: [] };
      this.cachedMtimeMs = -1;
      return this.cached;
    }

    try {
      const stats = await fs.stat(this.orgPath);
      if (this.cachedMtimeMs === stats.mtimeMs) {
        return this.cached;
      }

      const raw = await fs.readFile(this.orgPath, 'utf-8');
      this.cached = normalizeOrgData(tryParseJson(raw));
      this.cachedMtimeMs = stats.mtimeMs;
      return this.cached;
    } catch {
      return this.cached;
    }
  }
}

function normalizeOrgData(input: unknown): OrgData {
  const candidate = (input ?? {}) as {
    departments?: unknown;
    people?: unknown;
  };

  const departments = Array.isArray(candidate.departments)
    ? candidate.departments
        .map((department) => normalizeOrgDepartment(department))
        .filter((department): department is OrgDepartment => department !== null)
    : [];

  const people = Array.isArray(candidate.people)
    ? candidate.people
        .map((person) => normalizeOrgPerson(person))
        .filter((person): person is OrgPerson => person !== null)
    : [];

  return { departments, people };
}

function normalizeOrgDepartment(input: unknown): OrgDepartment | null {
  const candidate = (input ?? {}) as Partial<OrgDepartment>;
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
    return null;
  }

  const teams = Array.isArray(candidate.teams)
    ? candidate.teams
        .map((team) => String(team).trim())
        .filter((team) => team.length > 0)
    : [];

  return {
    name: candidate.name.trim(),
    vp: typeof candidate.vp === 'string' ? candidate.vp.trim() : '',
    teams: Array.from(new Set(teams)),
    headcount:
      typeof candidate.headcount === 'number' && Number.isFinite(candidate.headcount)
        ? Math.max(0, Math.trunc(candidate.headcount))
        : 0,
  };
}

function normalizeOrgPerson(input: unknown): OrgPerson | null {
  const candidate = (input ?? {}) as Partial<OrgPerson>;
  if (typeof candidate.matrixId !== 'string' || candidate.matrixId.trim().length === 0) {
    return null;
  }

  let normalizedMatrixId: string;
  try {
    normalizedMatrixId = normalizeMatrixId(candidate.matrixId);
  } catch {
    return null;
  }

  const directReports = Array.isArray(candidate.directReports)
    ? candidate.directReports
        .map((matrixId) => normalizeNullableMatrixId(String(matrixId)))
        .filter((matrixId): matrixId is string => matrixId !== null)
    : [];

  return {
    name: typeof candidate.name === 'string' && candidate.name.trim().length > 0 ? candidate.name.trim() : normalizedMatrixId,
    title: typeof candidate.title === 'string' && candidate.title.trim().length > 0 ? candidate.title.trim() : 'Agent',
    level: typeof candidate.level === 'string' && candidate.level.trim().length > 0 ? candidate.level.trim() : 'IC',
    department:
      typeof candidate.department === 'string' && candidate.department.trim().length > 0
        ? candidate.department.trim()
        : 'Unassigned',
    team:
      typeof candidate.team === 'string' && candidate.team.trim().length > 0
        ? candidate.team.trim()
        : null,
    matrixId: normalizedMatrixId,
    reportsTo: normalizeNullableMatrixId(candidate.reportsTo ?? null),
    directReports: Array.from(new Set(directReports)),
  };
}

function parsePeopleAction(value: unknown): PeopleAction | null {
  if (typeof value !== 'string') {
    return null;
  }

  const action = value.trim().toLowerCase();
  if (!PEOPLE_ACTIONS.includes(action as PeopleAction)) {
    return null;
  }
  return action as PeopleAction;
}

function parsePeopleLimit(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.max(1, Math.min(MAX_PEOPLE_QUERY_LIMIT, Math.trunc(parsed)));
}

function parseTaskStatus(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();
  if (!candidate) {
    return null;
  }
  return TASK_STATUSES.includes(candidate as TaskStatus) ? (candidate as TaskStatus) : null;
}

function parseTaskPriority(value: unknown): TaskPriority | null {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();
  if (!candidate) {
    return null;
  }
  return TASK_PRIORITIES.includes(candidate as TaskPriority) ? (candidate as TaskPriority) : null;
}

function parseTaskLimit(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.max(1, Math.min(MAX_TASK_QUERY_LIMIT, Math.trunc(parsed)));
}

function parseTaskTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value === 'string') {
    return value.split(',');
  }

  return [];
}

function parseActorMatrixId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return normalizeMatrixId(trimmed);
  } catch {
    return null;
  }
}

function formatOrgPerson(person: OrgPerson): string {
  return `${person.name} | ${person.title} | ${person.department}${person.team ? `/${person.team}` : ''} | ${person.matrixId}`;
}

function normalizePeopleQueryMatrixId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    return normalizeMatrixId(trimmed);
  } catch {
    return trimmed;
  }
}

function queryPeopleDirectory(org: OrgData, action: PeopleAction, rawQuery: string, limit: number): string[] {
  const query = rawQuery.trim();
  const lowered = query.toLowerCase();
  const byMatrixId = new Map(org.people.map((person) => [person.matrixId, person]));

  switch (action) {
    case 'search':
      return org.people
        .filter((person) => person.name.toLowerCase().includes(lowered))
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case 'find': {
      const person = byMatrixId.get(normalizePeopleQueryMatrixId(query));
      return person ? [formatOrgPerson(person)] : [];
    }
    case 'department':
      return org.people
        .filter((person) => person.department.toLowerCase() === lowered)
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case 'team':
      return org.people
        .filter((person) => person.team?.toLowerCase() === lowered)
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case 'title':
      return org.people
        .filter((person) => person.title.toLowerCase().includes(lowered))
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case 'level':
      return org.people
        .filter((person) => person.level.toLowerCase() === lowered)
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case 'manager': {
      const person = byMatrixId.get(normalizePeopleQueryMatrixId(query));
      if (!person?.reportsTo) {
        return [];
      }
      const manager = byMatrixId.get(person.reportsTo);
      return manager ? [formatOrgPerson(manager)] : [];
    }
    case 'reports': {
      const person = byMatrixId.get(normalizePeopleQueryMatrixId(query));
      if (!person) {
        return [];
      }
      return person.directReports
        .map((matrixId) => byMatrixId.get(matrixId))
        .filter((entry): entry is OrgPerson => entry !== undefined)
        .slice(0, limit)
        .map((entry) => formatOrgPerson(entry));
    }
    case 'chain': {
      const person = byMatrixId.get(normalizePeopleQueryMatrixId(query));
      if (!person) {
        return [];
      }

      const visited = new Set<string>();
      const chain: OrgPerson[] = [];
      let current = person.reportsTo ? byMatrixId.get(person.reportsTo) : undefined;
      while (current && !visited.has(current.matrixId)) {
        visited.add(current.matrixId);
        chain.push(current);
        current = current.reportsTo ? byMatrixId.get(current.reportsTo) : undefined;
      }

      return chain.map((entry) => formatOrgPerson(entry));
    }
    case 'list':
      if (lowered === 'departments') {
        return org.departments.map((department) => `${department.name} (${department.headcount} people)`);
      }
      if (lowered === 'teams') {
        return Array.from(new Set(org.people.map((person) => person.team).filter((team): team is string => Boolean(team)))).sort();
      }
      if (lowered === 'titles') {
        return Array.from(new Set(org.people.map((person) => person.title))).sort().slice(0, limit);
      }
      if (lowered === 'levels') {
        return Array.from(new Set(org.people.map((person) => person.level))).sort().slice(0, limit);
      }
      return [];
    default:
      return [];
  }
}

class EventHub {
  private readonly clients = new Set<Response>();

  addClient(res: Response): void {
    this.clients.add(res);
    this.emitToClient(res, 'connected', { ok: true });
  }

  removeClient(res: Response): void {
    this.clients.delete(res);
  }

  emit(eventName: string, payload: unknown): void {
    for (const client of this.clients) {
      this.emitToClient(client, eventName, payload);
    }
  }

  private emitToClient(client: Response, eventName: string, payload: unknown): void {
    client.write(`event: ${eventName}\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

const sessions = new Map<string, UserSession>();
const store = new StateStore(STATE_FILE);
const orgDirectory = new OrgDirectory(ORG_FILE_PATH);
const eventHub = new EventHub();

function normalizeMatrixId(matrixId: string): string {
  const trimmed = matrixId.trim();
  if (!trimmed) {
    throw new Error('Matrix ID cannot be empty');
  }

  if (trimmed.startsWith('@')) {
    if (trimmed.includes(':')) {
      return trimmed;
    }
    return `${trimmed}:${MATRIX_DOMAIN}`;
  }

  if (trimmed.includes(':')) {
    return `@${trimmed}`;
  }

  return `@${trimmed}:${MATRIX_DOMAIN}`;
}

function normalizeNullableMatrixId(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return normalizeMatrixId(trimmed);
}

function sanitizeRequiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function sanitizeTags(values: string[]): string[] {
  const normalized = values
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => value.length > 0)
    .slice(0, 12);

  return Array.from(new Set(normalized));
}

async function matrixRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  options: {
    body?: unknown;
    accessToken?: string;
    homeserver?: string;
  } = {},
): Promise<T> {
  const endpoint = new URL(path, options.homeserver ?? MATRIX_HOMESERVER);
  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payloadText = await response.text();
  const payload = payloadText.length > 0 ? tryParseJson(payloadText) : {};

  if (!response.ok) {
    const details = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : payloadText;
    throw new Error(`Matrix request failed (${response.status}): ${details}`);
  }

  return payload as T;
}

function tryParseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

async function loginToMatrix(matrixId: string, password: string): Promise<{ accessToken: string; userId: string }> {
  const normalizedId = normalizeMatrixId(matrixId);
  const username = normalizedId.split(':')[0].slice(1);

  const payload = {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
  };

  try {
    const response = await matrixRequest<{ access_token: string; user_id: string }>('/_matrix/client/v3/login', 'POST', {
      body: payload,
    });

    return {
      accessToken: response.access_token,
      userId: response.user_id,
    };
  } catch {
    const fallback = await matrixRequest<{ access_token: string; user_id: string }>('/_matrix/client/r0/login', 'POST', {
      body: payload,
    });

    return {
      accessToken: fallback.access_token,
      userId: fallback.user_id,
    };
  }
}

function deriveMatrixPassword(matrixId: string): string {
  if (!MATRIX_PASSWORD_SEED) {
    throw new Error('MATRIX_PASSWORD_SEED is not configured');
  }

  return createHmac('sha256', MATRIX_PASSWORD_SEED).update(normalizeMatrixId(matrixId)).digest('hex').slice(0, 32);
}

async function registerMatrixUser(matrixId: string, password: string): Promise<void> {
  const normalizedId = normalizeMatrixId(matrixId);
  const username = normalizedId.split(':')[0].slice(1);

  try {
    await matrixRequest('/_matrix/client/v3/register', 'POST', {
      body: {
        username,
        password,
        auth: { type: 'm.login.dummy' },
      },
    });
  } catch {
    await matrixRequest('/_matrix/client/r0/register', 'POST', {
      body: {
        username,
        password,
        auth: { type: 'm.login.dummy' },
      },
    });
  }
}

async function createActorSession(matrixId: string): Promise<UserSession | null> {
  if (!MATRIX_PASSWORD_SEED) {
    return null;
  }

  const password = deriveMatrixPassword(matrixId);

  try {
    const login = await loginToMatrix(matrixId, password);
    const now = Date.now();
    return {
      sessionId: `service_${randomUUID()}`,
      userId: login.userId,
      accessToken: login.accessToken,
      homeserver: MATRIX_HOMESERVER,
      createdAt: now,
      expiresAt: now + (5 * 60 * 1000),
    };
  } catch {
    try {
      await registerMatrixUser(matrixId, password);
      const login = await loginToMatrix(matrixId, password);
      const now = Date.now();
      return {
        sessionId: `service_${randomUUID()}`,
        userId: login.userId,
        accessToken: login.accessToken,
        homeserver: MATRIX_HOMESERVER,
        createdAt: now,
        expiresAt: now + (5 * 60 * 1000),
      };
    } catch {
      return null;
    }
  }
}

function getTaskAssignmentBotMatrixId(): string | null {
  if (!TASK_ASSIGNMENT_BOT_MATRIX_ID) {
    return null;
  }

  try {
    return normalizeMatrixId(TASK_ASSIGNMENT_BOT_MATRIX_ID);
  } catch {
    return null;
  }
}

async function resolveNotificationSession(actorMatrixId: string, fallbackSession?: UserSession): Promise<UserSession | null> {
  const botMatrixId = getTaskAssignmentBotMatrixId();
  if (botMatrixId) {
    const botSession = await createActorSession(botMatrixId);
    if (botSession) {
      return botSession;
    }
  }

  if (fallbackSession) {
    return fallbackSession;
  }

  return await createActorSession(actorMatrixId);
}

function parseCookie(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const entries = cookieHeader.split(';').map((entry) => entry.trim());
  for (const entry of entries) {
    if (!entry.startsWith(`${key}=`)) {
      continue;
    }

    const rawValue = entry.slice(key.length + 1);
    return decodeURIComponent(rawValue);
  }

  return null;
}

function getSessionFromRequest(req: Request): UserSession | null {
  const sessionId = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  (req as AuthedRequest).session = session;
  next();
}

function requireServiceAuth(req: Request, res: Response, next: NextFunction): void {
  if (!COMMAND_CENTER_API_TOKEN) {
    next();
    return;
  }

  const headerToken =
    String(req.headers[COMMAND_CENTER_API_TOKEN_HEADER] ?? '').trim()
    || String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();

  if (!headerToken || headerToken !== COMMAND_CENTER_API_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

function roomAliasToIdentifier(roomAliasInput: string, fallbackAlias: string): string {
  const trimmed = roomAliasInput.trim();
  const base = trimmed.length > 0 ? trimmed : fallbackAlias;

  if (base.startsWith('#') && base.includes(':')) {
    return base;
  }

  if (base.startsWith('#')) {
    return `${base}:${MATRIX_DOMAIN}`;
  }

  if (base.includes(':')) {
    return `#${base}`;
  }

  return `#${base}:${MATRIX_DOMAIN}`;
}

async function ensureDirectRoomWithUser(session: UserSession, peerMatrixId: string): Promise<string> {
  const normalizedPeer = normalizeMatrixId(peerMatrixId);

  let directMap: Record<string, string[]> = {};
  try {
    const payload = await matrixRequest<unknown>(
      `/_matrix/client/r0/user/${encodeURIComponent(session.userId)}/account_data/m.direct`,
      'GET',
      {
        accessToken: session.accessToken,
        homeserver: session.homeserver,
      },
    );
    if (typeof payload === 'object' && payload !== null) {
      directMap = payload as Record<string, string[]>;
    }
  } catch {
    // Account data may not exist yet for this user.
    directMap = {};
  }

  const existingRoomIds = Array.isArray(directMap[normalizedPeer]) ? directMap[normalizedPeer] : [];
  if (existingRoomIds.length > 0) {
    return existingRoomIds[0];
  }

  const created = await matrixRequest<{ room_id: string }>(
    '/_matrix/client/r0/createRoom',
    'POST',
    {
      accessToken: session.accessToken,
      homeserver: session.homeserver,
      body: {
        is_direct: true,
        invite: [normalizedPeer],
        preset: 'trusted_private_chat',
        name: 'Task Assignments',
      },
    },
  );

  const updated = {
    ...directMap,
    [normalizedPeer]: Array.from(new Set([...(directMap[normalizedPeer] ?? []), created.room_id])),
  };

  await matrixRequest(
    `/_matrix/client/r0/user/${encodeURIComponent(session.userId)}/account_data/m.direct`,
    'PUT',
    {
      accessToken: session.accessToken,
      homeserver: session.homeserver,
      body: updated,
    },
  );

  return created.room_id;
}

async function notifyAssigneeForTask(
  session: UserSession,
  task: Task,
  assigneeMatrixId: string,
  reason: 'created' | 'reassigned',
): Promise<{ sent: boolean; error: string | null }> {
  const assignee = normalizeMatrixId(assigneeMatrixId);
  if (assignee === normalizeMatrixId(session.userId)) {
    return { sent: false, error: null };
  }

  const action = reason === 'created' ? 'New task assigned' : 'Task reassigned';
  const boardTaskUrl = `${COMMAND_CENTER_PUBLIC_URL}/#task=${encodeURIComponent(task.id)}`;
  const messageLines = [
    `${action}: ${task.title}`,
    `Task ID: ${task.id}`,
    `Creator: ${task.creatorMatrixId}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    `Deliverable: ${task.deliverable}`,
    task.description ? `Description: ${task.description}` : null,
    '',
    'Next steps:',
    `1) Track updates in Command Center task board: ${boardTaskUrl}`,
    `2) Post progress/blockers in task comments on ${task.id}`,
    `3) Coordinate directly with creator: ${task.creatorMatrixId}`,
  ].filter((line): line is string => line !== null);

  try {
    const roomId = await ensureDirectRoomWithUser(session, assignee);
    await matrixRequest(
      `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
      'PUT',
      {
        accessToken: session.accessToken,
        homeserver: session.homeserver,
        body: {
          msgtype: 'm.text',
          body: messageLines.join('\n'),
        },
      },
    );
    return { sent: true, error: null };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'Failed to notify assignee via Matrix',
    };
  }
}

function buildAgentStatusMap(tasks: Task[]): Map<string, 'working' | 'idle'> {
  const map = new Map<string, 'working' | 'idle'>();

  for (const task of tasks) {
    if (!task.assigneeMatrixId) {
      continue;
    }

    const working = task.status === 'assigned' || task.status === 'in_progress' || task.status === 'review';
    if (working) {
      map.set(task.assigneeMatrixId, 'working');
    } else if (!map.has(task.assigneeMatrixId)) {
      map.set(task.assigneeMatrixId, 'idle');
    }
  }

  return map;
}

async function listDeployedAgentMatrixIds(): Promise<Set<string>> {
  const deployed = new Set<string>();
  if (!existsSync(WORKSPACES_ROOT)) {
    return deployed;
  }

  try {
    const departmentDirs = await fs.readdir(WORKSPACES_ROOT, { withFileTypes: true });
    for (const department of departmentDirs) {
      if (!department.isDirectory()) {
        continue;
      }

      const departmentPath = join(WORKSPACES_ROOT, department.name);
      const agentDirs = await fs.readdir(departmentPath, { withFileTypes: true });
      for (const agent of agentDirs) {
        if (!agent.isDirectory()) {
          continue;
        }

        deployed.add(normalizeMatrixId(`@${agent.name}:${MATRIX_DOMAIN}`));
      }
    }
  } catch {
    // Fall back to org/task-derived agents if workspace scan fails.
  }

  return deployed;
}

async function loadAgents(tasks: Task[]): Promise<AgentSummary[]> {
  const statusMap = buildAgentStatusMap(tasks);
  const deployedMatrixIds = await listDeployedAgentMatrixIds();
  const seen = new Set<string>();
  const agents: AgentSummary[] = [];
  const orgData = await orgDirectory.getSnapshot();
  for (const person of orgData.people) {
    const matrixId = normalizeMatrixId(person.matrixId);
    if (seen.has(matrixId)) {
      continue;
    }

    seen.add(matrixId);
    const deployed = deployedMatrixIds.size === 0 || deployedMatrixIds.has(matrixId);
    agents.push({
      matrixId,
      name: person.name ?? matrixId,
      title: person.title ?? 'Agent',
      department: person.department ?? 'Unassigned',
      team: person.team ?? 'General',
      status: statusMap.get(matrixId) ?? (deployed ? 'idle' : 'external'),
    });
  }

  if (deployedMatrixIds.size > 0) {
    for (const matrixId of deployedMatrixIds) {
      if (seen.has(matrixId)) {
        continue;
      }

      seen.add(matrixId);
      agents.push({
        matrixId,
        name: matrixId,
        title: 'Agent',
        department: 'Unassigned',
        team: 'General',
        status: statusMap.get(matrixId) ?? 'idle',
      });
    }
  }

  for (const task of tasks) {
    for (const matrixId of [task.creatorMatrixId, task.assigneeMatrixId]) {
      if (!matrixId || seen.has(matrixId)) {
        continue;
      }

      seen.add(matrixId);
      const deployed = deployedMatrixIds.size === 0 || deployedMatrixIds.has(matrixId);
      agents.push({
        matrixId,
        name: matrixId,
        title: 'Agent',
        department: 'Unassigned',
        team: 'General',
        status: statusMap.get(matrixId) ?? (deployed ? 'idle' : 'external'),
      });
    }
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

async function bootstrap(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  await store.init();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, service: 'command-center' });
  });

  app.post('/api/auth/login', async (req, res) => {
    const matrixId = String(req.body?.matrixId ?? '').trim();
    const password = String(req.body?.password ?? '').trim();

    if (!matrixId || !password) {
      res.status(400).json({ error: 'matrixId and password are required' });
      return;
    }

    try {
      const login = await loginToMatrix(matrixId, password);
      const sessionId = randomUUID();
      const now = Date.now();

      sessions.set(sessionId, {
        sessionId,
        userId: login.userId,
        accessToken: login.accessToken,
        homeserver: MATRIX_HOMESERVER,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });

      res.cookie(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });

      res.status(200).json({ userId: login.userId, homeserver: MATRIX_HOMESERVER });
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed' });
    }
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const session = (req as AuthedRequest).session;
    sessions.delete(session.sessionId);

    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(200).json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const session = (req as AuthedRequest).session;
    res.status(200).json({
      userId: session.userId,
      homeserver: session.homeserver,
      expiresAt: session.expiresAt,
      realtime: true,
    });
  });

  app.post('/api/people/query', requireServiceAuth, async (req, res) => {
    const action = parsePeopleAction(req.body?.action);
    if (!action) {
      res.status(400).json({ error: `action is required. Supported actions: ${PEOPLE_ACTIONS.join(', ')}` });
      return;
    }

    const query = String(req.body?.query ?? '');
    const limit = parsePeopleLimit(req.body?.limit);

    const directory = await orgDirectory.getSnapshot();
    const results = queryPeopleDirectory(directory, action, query, limit);

    res.status(200).json({
      action,
      query,
      limit,
      count: results.length,
      results,
    });
  });

  async function buildDashboardPayload(currentUser: string): Promise<{
    currentUser: string;
    agents: AgentSummary[];
    tasks: Task[];
    activity: ActivityEvent[];
    totals: {
      totalTasks: number;
      inProgress: number;
      review: number;
      completed: number;
      activeAgents: number;
    };
    statuses: typeof TASK_STATUSES;
    priorities: typeof TASK_PRIORITIES;
  }> {
    const snapshot = store.getSnapshot();
    const agents = await loadAgents(snapshot.tasks);

    return {
      currentUser,
      agents,
      tasks: snapshot.tasks,
      activity: snapshot.activity,
      totals: {
        totalTasks: snapshot.tasks.length,
        inProgress: snapshot.tasks.filter((task) => task.status === 'in_progress').length,
        review: snapshot.tasks.filter((task) => task.status === 'review').length,
        completed: snapshot.tasks.filter((task) => task.status === 'done').length,
        activeAgents: agents.filter((agent) => agent.status === 'working' || agent.status === 'idle').length,
      },
      statuses: TASK_STATUSES,
      priorities: TASK_PRIORITIES,
    };
  }

  function attachEventStream(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    eventHub.addClient(res);

    req.on('close', () => {
      eventHub.removeClient(res);
      res.end();
    });
  }

  app.get('/api/agent/dashboard', requireServiceAuth, async (req, res) => {
    const snapshot = store.getSnapshot();
    const fallbackUser = TASK_ASSIGNMENT_BOT_MATRIX_ID || snapshot.tasks[0]?.creatorMatrixId || '@unknown:anycompany.corp';
    res.status(200).json(await buildDashboardPayload(fallbackUser));
  });

  app.get('/api/agent/tasks', requireServiceAuth, (req, res) => {
    const snapshot = store.getSnapshot();
    let tasks = snapshot.tasks;

    const status = parseTaskStatus(req.query.status);
    if (req.query.status !== undefined && status === null) {
      res.status(400).json({ error: `invalid status. Supported statuses: ${TASK_STATUSES.join(', ')}` });
      return;
    }
    if (status) {
      tasks = tasks.filter((task) => task.status === status);
    }

    const includeDoneRaw = String(req.query.includeDone ?? 'true').trim().toLowerCase();
    const includeDone = !(includeDoneRaw === 'false' || includeDoneRaw === '0' || includeDoneRaw === 'no');
    if (!includeDone) {
      tasks = tasks.filter((task) => task.status !== 'done');
    }

    if (req.query.assigneeMatrixId !== undefined) {
      const assigneeMatrixId = parseActorMatrixId(req.query.assigneeMatrixId);
      if (!assigneeMatrixId) {
        res.status(400).json({ error: 'assigneeMatrixId is invalid' });
        return;
      }
      tasks = tasks.filter((task) => task.assigneeMatrixId === assigneeMatrixId);
    }

    if (req.query.creatorMatrixId !== undefined) {
      const creatorMatrixId = parseActorMatrixId(req.query.creatorMatrixId);
      if (!creatorMatrixId) {
        res.status(400).json({ error: 'creatorMatrixId is invalid' });
        return;
      }
      tasks = tasks.filter((task) => task.creatorMatrixId === creatorMatrixId);
    }

    const query = String(req.query.query ?? '').trim().toLowerCase();
    if (query) {
      tasks = tasks.filter((task) => {
        return (
          task.id.toLowerCase().includes(query)
          || task.title.toLowerCase().includes(query)
          || task.description.toLowerCase().includes(query)
          || task.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      });
    }

    const limit = parseTaskLimit(req.query.limit);
    const sliced = tasks.slice(0, limit);
    res.status(200).json({
      count: sliced.length,
      total: tasks.length,
      limit,
      tasks: sliced,
    });
  });

  app.get('/api/agent/tasks/:taskId', requireServiceAuth, (req, res) => {
    const snapshot = store.getSnapshot();
    const task = snapshot.tasks.find((entry) => entry.id === req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.status(200).json(task);
  });

  app.post('/api/agent/tasks', requireServiceAuth, async (req, res) => {
    const actorMatrixId = parseActorMatrixId(req.body?.actorMatrixId);
    if (!actorMatrixId) {
      res.status(400).json({ error: 'actorMatrixId is required' });
      return;
    }

    const title = String(req.body?.title ?? '').trim();
    const deliverable = String(req.body?.deliverable ?? '').trim();

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!deliverable) {
      res.status(400).json({ error: 'deliverable is required' });
      return;
    }

    const priority = parseTaskPriority(req.body?.priority) ?? 'medium';

    try {
      const task = await store.createTask(
        {
          title,
          description: String(req.body?.description ?? ''),
          priority,
          assigneeMatrixId: req.body?.assigneeMatrixId ? String(req.body.assigneeMatrixId) : null,
          tags: parseTaskTags(req.body?.tags),
          deliverable,
        },
        actorMatrixId,
      );

      let assignmentNotification: { sent: boolean; error: string | null } = { sent: false, error: null };
      if (task.assigneeMatrixId) {
        const notificationSession = await resolveNotificationSession(actorMatrixId);
        if (notificationSession) {
          assignmentNotification = await notifyAssigneeForTask(notificationSession, task, task.assigneeMatrixId, 'created');
        } else {
          assignmentNotification = {
            sent: false,
            error: 'Unable to establish Matrix session for assignment notification',
          };
        }
      }

      eventHub.emit('dashboard_update', { reason: 'task_created', taskId: task.id });
      res.status(201).json({
        ...task,
        assignmentNotification,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create task' });
    }
  });

  app.patch('/api/agent/tasks/:taskId', requireServiceAuth, async (req, res) => {
    const actorMatrixId = parseActorMatrixId(req.body?.actorMatrixId);
    const previousTask = store.getSnapshot().tasks.find((entry) => entry.id === req.params.taskId) ?? null;
    const previousAssignee = previousTask?.assigneeMatrixId ?? null;
    if (!actorMatrixId) {
      res.status(400).json({ error: 'actorMatrixId is required' });
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body ?? {}, 'deliverable')
      && !String(req.body?.deliverable ?? '').trim()
    ) {
      res.status(400).json({ error: 'deliverable is required' });
      return;
    }

    const status = parseTaskStatus(req.body?.status);
    if (req.body?.status !== undefined && status === null) {
      res.status(400).json({ error: `invalid status. Supported statuses: ${TASK_STATUSES.join(', ')}` });
      return;
    }

    const priority = parseTaskPriority(req.body?.priority);
    if (req.body?.priority !== undefined && priority === null) {
      res.status(400).json({ error: `invalid priority. Supported priorities: ${TASK_PRIORITIES.join(', ')}` });
      return;
    }

    const update: UpdateTaskInput = {};
    if (typeof req.body?.title === 'string') {
      update.title = req.body.title;
    }
    if (typeof req.body?.description === 'string') {
      update.description = req.body.description;
    }
    if (status) {
      update.status = status;
    }
    if (priority) {
      update.priority = priority;
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'assigneeMatrixId')) {
      update.assigneeMatrixId = req.body.assigneeMatrixId ? String(req.body.assigneeMatrixId) : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'tags')) {
      update.tags = parseTaskTags(req.body?.tags);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'deliverable')) {
      update.deliverable = String(req.body.deliverable);
    }

    try {
      const task = await store.updateTask(req.params.taskId, update, actorMatrixId);
      let assignmentNotification: { sent: boolean; error: string | null } = { sent: false, error: null };
      if (task.assigneeMatrixId && task.assigneeMatrixId !== previousAssignee) {
        const notificationSession = await resolveNotificationSession(actorMatrixId);
        if (notificationSession) {
          assignmentNotification = await notifyAssigneeForTask(notificationSession, task, task.assigneeMatrixId, 'reassigned');
        } else {
          assignmentNotification = {
            sent: false,
            error: 'Unable to establish Matrix session for assignment notification',
          };
        }
      }

      eventHub.emit('dashboard_update', { reason: 'task_updated', taskId: task.id });
      res.status(200).json({
        ...task,
        assignmentNotification,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update task';
      const statusCode = message === 'Task not found' ? 404 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/agent/tasks/:taskId/comments', requireServiceAuth, async (req, res) => {
    const actorMatrixId = parseActorMatrixId(req.body?.actorMatrixId);
    if (!actorMatrixId) {
      res.status(400).json({ error: 'actorMatrixId is required' });
      return;
    }

    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const task = await store.addComment(req.params.taskId, message, actorMatrixId);
      eventHub.emit('dashboard_update', { reason: 'comment_added', taskId: task.id });
      res.status(201).json(task);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to add comment';
      const statusCode = text === 'Task not found' ? 404 : 500;
      res.status(statusCode).json({ error: text });
    }
  });

  app.get('/api/agent/events', requireServiceAuth, attachEventStream);
  app.get('/api/events', requireAuth, attachEventStream);

  app.get('/api/dashboard', requireAuth, async (req, res) => {
    const session = (req as AuthedRequest).session;
    res.status(200).json(await buildDashboardPayload(session.userId));
  });

  app.post('/api/tasks', requireAuth, async (req, res) => {
    const session = (req as AuthedRequest).session;
    const title = String(req.body?.title ?? '').trim();
    const deliverable = String(req.body?.deliverable ?? '').trim();

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!deliverable) {
      res.status(400).json({ error: 'deliverable is required' });
      return;
    }

    const priorityInput = String(req.body?.priority ?? 'medium').trim() as TaskPriority;
    const priority = TASK_PRIORITIES.includes(priorityInput) ? priorityInput : 'medium';

    const tagsInput = Array.isArray(req.body?.tags)
      ? req.body.tags.map((entry: unknown) => String(entry))
      : typeof req.body?.tags === 'string'
        ? req.body.tags.split(',')
        : [];

    try {
      const task = await store.createTask(
        {
          title,
          description: String(req.body?.description ?? ''),
          priority,
          assigneeMatrixId: req.body?.assigneeMatrixId ? String(req.body.assigneeMatrixId) : null,
          tags: tagsInput,
          deliverable,
        },
        session.userId,
      );

      let assignmentNotification: { sent: boolean; error: string | null } = { sent: false, error: null };
      if (task.assigneeMatrixId) {
        const notificationSession = await resolveNotificationSession(session.userId, session);
        if (notificationSession) {
          assignmentNotification = await notifyAssigneeForTask(notificationSession, task, task.assigneeMatrixId, 'created');
          if (assignmentNotification.error) {
            console.warn(`Task assignment notification failed for ${task.id}: ${assignmentNotification.error}`);
          }
        } else {
          assignmentNotification = {
            sent: false,
            error: 'Unable to establish Matrix session for assignment notification',
          };
        }
      }

      eventHub.emit('dashboard_update', { reason: 'task_created', taskId: task.id });
      res.status(201).json({
        ...task,
        assignmentNotification,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create task' });
    }
  });

  app.patch('/api/tasks/:taskId', requireAuth, async (req, res) => {
    const session = (req as AuthedRequest).session;
    const previousTask = store.getSnapshot().tasks.find((entry) => entry.id === req.params.taskId) ?? null;
    const previousAssignee = previousTask?.assigneeMatrixId ?? null;
    const statusInput = req.body?.status ? String(req.body.status).trim() : undefined;
    const priorityInput = req.body?.priority ? String(req.body.priority).trim() : undefined;

    if (
      Object.prototype.hasOwnProperty.call(req.body ?? {}, 'deliverable')
      && !String(req.body?.deliverable ?? '').trim()
    ) {
      res.status(400).json({ error: 'deliverable is required' });
      return;
    }

    const update: UpdateTaskInput = {};
    if (typeof req.body?.title === 'string') {
      update.title = req.body.title;
    }
    if (typeof req.body?.description === 'string') {
      update.description = req.body.description;
    }
    if (statusInput && TASK_STATUSES.includes(statusInput as TaskStatus)) {
      update.status = statusInput as TaskStatus;
    }
    if (priorityInput && TASK_PRIORITIES.includes(priorityInput as TaskPriority)) {
      update.priority = priorityInput as TaskPriority;
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'assigneeMatrixId')) {
      update.assigneeMatrixId = req.body.assigneeMatrixId ? String(req.body.assigneeMatrixId) : null;
    }
    if (Array.isArray(req.body?.tags)) {
      update.tags = req.body.tags.map((entry: unknown) => String(entry));
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'deliverable')) {
      update.deliverable = String(req.body.deliverable);
    }

    try {
      const task = await store.updateTask(req.params.taskId, update, session.userId);
      let assignmentNotification: { sent: boolean; error: string | null } = { sent: false, error: null };
      if (task.assigneeMatrixId && task.assigneeMatrixId !== previousAssignee) {
        const notificationSession = await resolveNotificationSession(session.userId, session);
        if (notificationSession) {
          assignmentNotification = await notifyAssigneeForTask(notificationSession, task, task.assigneeMatrixId, 'reassigned');
          if (assignmentNotification.error) {
            console.warn(`Task reassignment notification failed for ${task.id}: ${assignmentNotification.error}`);
          }
        } else {
          assignmentNotification = {
            sent: false,
            error: 'Unable to establish Matrix session for assignment notification',
          };
        }
      }

      eventHub.emit('dashboard_update', { reason: 'task_updated', taskId: task.id });
      res.status(200).json({
        ...task,
        assignmentNotification,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update task';
      const statusCode = message === 'Task not found' ? 404 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/tasks/:taskId/comments', requireAuth, async (req, res) => {
    const session = (req as AuthedRequest).session;
    const message = String(req.body?.message ?? '').trim();

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const task = await store.addComment(req.params.taskId, message, session.userId);
      eventHub.emit('dashboard_update', { reason: 'comment_added', taskId: task.id });
      res.status(201).json(task);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to add comment';
      const statusCode = text === 'Task not found' ? 404 : 500;
      res.status(statusCode).json({ error: text });
    }
  });

  app.post('/api/matrix/broadcast', requireAuth, async (req, res) => {
    const session = (req as AuthedRequest).session;
    const message = String(req.body?.message ?? '').trim();
    const roomAlias = roomAliasToIdentifier(String(req.body?.roomAlias ?? '#all-employees'), '#all-employees');

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const joinResult = await matrixRequest<{ room_id: string }>(
        `/_matrix/client/r0/join/${encodeURIComponent(roomAlias)}`,
        'POST',
        {
          body: {},
          accessToken: session.accessToken,
          homeserver: session.homeserver,
        },
      );

      const roomId = joinResult.room_id;
      await matrixRequest(
        `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
        'PUT',
        {
          accessToken: session.accessToken,
          homeserver: session.homeserver,
          body: {
            msgtype: 'm.text',
            body: message,
          },
        },
      );

      await store.recordBroadcast(session.userId, roomAlias);
      eventHub.emit('dashboard_update', { reason: 'broadcast_sent', roomAlias });
      res.status(200).json({ ok: true, roomId, roomAlias });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Broadcast failed' });
    }
  });

  const distDir = dirname(fileURLToPath(import.meta.url));
  const staticDir = [join(distDir, 'public'), join(distDir, '../src/public')].find((candidate) => existsSync(candidate));

  if (!staticDir) {
    throw new Error('Static assets were not found for command-center');
  }

  // Keep frontend pages/assets fresh during rapid local iterations.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/healthz') {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  app.get('/', (_req, res) => {
    res.redirect(302, '/tasks');
  });

  app.get('/index.html', (_req, res) => {
    res.redirect(302, '/tasks');
  });

  app.get('/comms', (_req, res) => {
    res.redirect(302, '/activities');
  });

  app.use(express.static(staticDir));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/healthz') {
      next();
      return;
    }

    res.sendFile(join(staticDir, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Command center listening on port ${PORT}`);
    console.log(`Matrix homeserver: ${MATRIX_HOMESERVER}`);
    console.log(`Command Center public URL: ${COMMAND_CENTER_PUBLIC_URL}`);
    console.log(`Task assignment sender: ${getTaskAssignmentBotMatrixId() ?? 'actor session'}`);
    console.log(`State file: ${STATE_FILE}`);
    console.log(`Org file: ${ORG_FILE_PATH}`);
  });

  setInterval(cleanupExpiredSessions, 60 * 1000).unref();
  setInterval(() => {
    eventHub.emit('keepalive', { ts: new Date().toISOString() });
  }, 25 * 1000).unref();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
