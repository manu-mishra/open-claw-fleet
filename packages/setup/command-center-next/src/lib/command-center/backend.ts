import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { Pool } from "pg";

const PORT = Number.parseInt(process.env.PORT ?? "8090", 10);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), ".command-center-data");
const STATE_FILE = join(DATA_DIR, "state.json");
const ORG_FILE_PATH = process.env.ORG_FILE_PATH ?? join(process.cwd(), "config/environments/local/workspaces/org.json");
const ORG_DEPLOYED_FILE_PATH = process.env.ORG_DEPLOYED_FILE_PATH ?? join(dirname(ORG_FILE_PATH), "deployed-org.json");
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT ?? dirname(ORG_FILE_PATH);
const MATRIX_HOMESERVER = process.env.MATRIX_HOMESERVER ?? "http://conduit:6167";
const MATRIX_DOMAIN = process.env.MATRIX_DOMAIN ?? "anycompany.corp";
const COMMAND_CENTER_PUBLIC_URL = (process.env.COMMAND_CENTER_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const COMMAND_CENTER_API_TOKEN = (process.env.COMMAND_CENTER_API_TOKEN ?? process.env.FLEET_SECRET ?? "").trim();
const COMMAND_CENTER_API_TOKEN_HEADER = "x-command-center-token";
const MATRIX_PASSWORD_SEED = (process.env.MATRIX_PASSWORD_SEED ?? process.env.FLEET_SECRET ?? COMMAND_CENTER_API_TOKEN).trim();
const TASK_ASSIGNMENT_BOT_MATRIX_ID = process.env.TASK_ASSIGNMENT_BOT_MATRIX_ID?.trim() ?? "";
const SHARED_FILES_ROOT = process.env.SHARED_FILES_ROOT?.trim() || "/data/shared";
const MAX_ATTACHMENT_BYTES = Number.parseInt(process.env.MAX_ATTACHMENT_BYTES ?? `${25 * 1024 * 1024}`, 10);
const COMMAND_CENTER_DB_MODE = (process.env.COMMAND_CENTER_DB_MODE ?? "").trim().toLowerCase();
const COMMAND_CENTER_DATABASE_URL = (process.env.COMMAND_CENTER_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
const POSTGRES_HOST = (process.env.PGHOST ?? "").trim();
const POSTGRES_PORT = Number.parseInt(process.env.PGPORT ?? "5432", 10);
const POSTGRES_DATABASE = (process.env.PGDATABASE ?? "command_center").trim();
const POSTGRES_USER = (process.env.PGUSER ?? "command_center").trim();
const POSTGRES_PASSWORD = (process.env.PGPASSWORD ?? "").trim();
const POSTGRES_SSL_MODE = (process.env.PGSSLMODE ?? "").trim().toLowerCase();

const MAX_ACTIVITY_EVENTS = 1500;
const MAX_PEOPLE_QUERY_LIMIT = 100;
const MAX_TASK_QUERY_LIMIT = 200;
const WBR_TAG = "wbr";
const WBR_WEEK_TAG_PREFIX = "week:";
const WBR_DEPARTMENT_TAG_PREFIX = "department:";

export const TASK_STATUSES = ["inbox", "assigned", "in_progress", "review", "done", "blocked"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_WORK_ITEM_TYPES = ["epic", "feature", "story", "task"] as const;
const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  inbox: ["assigned", "in_progress", "blocked"],
  assigned: ["in_progress", "review", "blocked"],
  in_progress: ["assigned", "review", "blocked"],
  review: ["done", "in_progress", "blocked"],
  blocked: ["assigned", "in_progress", "review", "done"],
  done: ["review", "in_progress"],
};
export const PEOPLE_ACTIONS = [
  "search",
  "find",
  "department",
  "team",
  "title",
  "level",
  "manager",
  "reports",
  "chain",
  "list",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskWorkItemType = (typeof TASK_WORK_ITEM_TYPES)[number];
export type PeopleAction = (typeof PEOPLE_ACTIONS)[number];

export interface TaskComment {
  id: string;
  authorMatrixId: string;
  message: string;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sharedPath: string;
  sourceKind: "upload" | "link";
  createdAt: string;
  createdByMatrixId: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  workItemType: TaskWorkItemType;
  parentTaskId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  creatorMatrixId: string;
  assigneeMatrixId: string | null;
  tags: string[];
  deliverable: string;
  blockedReason: string | null;
  blockerOwnerMatrixId: string | null;
  escalateToMatrixId: string | null;
  nextAction: string | null;
  ownerMatrixId: string | null;
  ownerName: string;
  department: string;
  departments: string[];
  team: string;
  vp: string;
  director: string;
  manager: string;
  matrixRoomId: string | null;
  matrixThreadRootEventId: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TaskComment[];
  attachments: TaskAttachment[];
}

interface TaskView extends Task {}

export interface ActivityEvent {
  id: string;
  type: "task_created" | "task_updated" | "comment_added" | "broadcast_sent";
  actorMatrixId: string;
  taskId: string | null;
  message: string;
  createdAt: string;
}

interface DashboardState {
  tasks: Task[];
  activity: ActivityEvent[];
}

export interface WbrEntrySummary {
  taskId: string;
  title: string;
  status: TaskStatus;
  assigneeMatrixId: string | null;
  assigneeName: string;
  vpMatrixId: string | null;
  updatedAt: string;
}

export interface WbrDepartmentSummary {
  department: string;
  vpMatrixId: string | null;
  expectedDirectors: number;
  totalEntries: number;
  submitted: number;
  pending: number;
  blocked: number;
  overdue: number;
  latestUpdatedAt: string | null;
  entries: WbrEntrySummary[];
}

export interface WbrWeeklySummary {
  weekStart: string;
  generatedAt: string;
  totals: {
    departments: number;
    expectedDirectors: number;
    totalEntries: number;
    submitted: number;
    pending: number;
    blocked: number;
    overdue: number;
  };
  departments: WbrDepartmentSummary[];
}

export interface WbrSeedResult {
  weekStart: string;
  generatedAt: string;
  created: number;
  existing: number;
  totalTargets: number;
  tasks: TaskView[];
}

interface CreateTaskInput {
  title: string;
  description?: string;
  workItemType?: TaskWorkItemType;
  parentTaskId?: string | null;
  priority?: TaskPriority;
  assigneeMatrixId?: string | null;
  tags?: string[];
  deliverable: string;
  blockedReason?: string | null;
  blockerOwnerMatrixId?: string | null;
  escalateToMatrixId?: string | null;
  nextAction?: string | null;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  workItemType?: TaskWorkItemType;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeMatrixId?: string | null;
  parentTaskId?: string | null;
  tags?: string[];
  deliverable?: string;
  blockedReason?: string | null;
  blockerOwnerMatrixId?: string | null;
  escalateToMatrixId?: string | null;
  nextAction?: string | null;
}

interface AddTaskAttachmentUploadInput {
  kind: "upload";
  fileName: string;
  contentType: string;
  data: Uint8Array;
}

interface AddTaskAttachmentLinkInput {
  kind: "link";
  sharedPath: string;
  fileName?: string;
  contentType?: string | null;
}

type AddTaskAttachmentInput = AddTaskAttachmentUploadInput | AddTaskAttachmentLinkInput;

export interface AgentSummary {
  matrixId: string;
  name: string;
  title: string;
  department: string;
  team: string;
  status: "working" | "idle" | "external";
}

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

interface UserSession {
  userId: string;
  accessToken: string;
  homeserver: string;
}

interface SseClient {
  id: string;
  send: (eventName: string, payload: unknown) => void;
  close: () => void;
}

function tryParseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function parseTaskStatus(value: unknown): TaskStatus | null {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    return null;
  }
  return TASK_STATUSES.includes(candidate as TaskStatus) ? (candidate as TaskStatus) : null;
}

function parseTaskPriority(value: unknown): TaskPriority | null {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    return null;
  }
  return TASK_PRIORITIES.includes(candidate as TaskPriority) ? (candidate as TaskPriority) : null;
}

function parseTaskWorkItemType(value: unknown): TaskWorkItemType | null {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!candidate) {
    return null;
  }
  return TASK_WORK_ITEM_TYPES.includes(candidate as TaskWorkItemType) ? (candidate as TaskWorkItemType) : null;
}

function parseTaskLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "20"), 10);
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(1, Math.min(MAX_TASK_QUERY_LIMIT, parsed));
}

function parsePeopleAction(value: unknown): PeopleAction | null {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    return null;
  }
  return PEOPLE_ACTIONS.includes(candidate as PeopleAction) ? (candidate as PeopleAction) : null;
}

function parsePeopleLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "10"), 10);
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return Math.max(1, Math.min(MAX_PEOPLE_QUERY_LIMIT, parsed));
}

function normalizeMatrixId(matrixId: string): string {
  const trimmed = matrixId.trim();
  if (!trimmed) {
    throw new Error("Matrix ID cannot be empty");
  }

  if (trimmed.startsWith("@")) {
    if (trimmed.includes(":")) {
      return trimmed;
    }
    return `${trimmed}:${MATRIX_DOMAIN}`;
  }

  if (trimmed.includes(":")) {
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

function matrixLocalPart(matrixId: string): string {
  const trimmed = matrixId.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const [localPart] = withoutAt.split(":");
  return localPart.toLowerCase();
}

function parseActorMatrixId(value: unknown): string | null {
  if (typeof value !== "string") {
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

function sanitizeRequiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function sanitizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeTags(values: string[]): string[] {
  const normalized = values
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => value.length > 0)
    .slice(0, 12);

  return Array.from(new Set(normalized));
}

function normalizeSearchText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@._:+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSearchTerms(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }
  return Array.from(new Set(normalized.split(" ").filter((term) => term.length > 0)));
}

function buildTaskSearchDocument(task: Task): string {
  const comments = task.comments.map((comment) => comment.message).join(" ");
  return normalizeSearchText(
    [
      task.id,
      task.title,
      task.description,
      task.deliverable,
      comments,
      task.workItemType,
      task.parentTaskId ?? "",
      ...task.tags,
    ].join(" "),
  );
}

function taskMatchesFullTextQuery(task: Task, query: string): boolean {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) {
    return true;
  }
  const searchable = buildTaskSearchDocument(task);
  return terms.every((term) => searchable.includes(term));
}

function sanitizeFileName(input: string): string {
  const base = basename(String(input || "attachment").trim());
  const collapsed = base.replace(/\s+/g, " ").trim();
  const safe = collapsed.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\.\.+/g, ".");
  return safe.length > 0 ? safe.slice(0, 160) : "attachment";
}

function contentTypeFromFileName(fileName: string, fallback = "application/octet-stream"): string {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".ts":
      return "text/typescript; charset=utf-8";
    case ".tsx":
      return "text/tsx; charset=utf-8";
    case ".jsx":
      return "text/jsx; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".py":
      return "text/x-python; charset=utf-8";
    case ".go":
      return "text/x-go; charset=utf-8";
    case ".java":
      return "text/x-java-source; charset=utf-8";
    case ".c":
      return "text/x-c; charset=utf-8";
    case ".cpp":
    case ".cc":
    case ".cxx":
      return "text/x-c++; charset=utf-8";
    case ".rs":
      return "text/rust; charset=utf-8";
    case ".yml":
    case ".yaml":
      return "application/yaml; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return fallback;
  }
}

function normalizeSharedPath(candidatePath: string): string {
  const trimmed = String(candidatePath ?? "").trim();
  if (!trimmed) {
    throw new Error("sharedPath is required");
  }

  const root = resolve(SHARED_FILES_ROOT);
  const rootUnix = root.split("\\").join("/");
  const candidateUnix = trimmed.split("\\").join("/");
  let candidateRelative = trimmed;

  if (candidateUnix === "/shared") {
    throw new Error("sharedPath must include a file under /shared");
  }
  if (candidateUnix.startsWith("/shared/")) {
    candidateRelative = candidateUnix.slice("/shared/".length);
  } else if (candidateUnix.startsWith(`${rootUnix}/`)) {
    candidateRelative = candidateUnix.slice(rootUnix.length + 1);
  }

  const resolvedPath = resolve(root, candidateRelative);
  const rel = relative(root, resolvedPath);
  if (!rel || rel === "." || rel.startsWith("..") || rel.includes(`..${"/"}`)) {
    throw new Error("sharedPath must resolve within shared storage root");
  }

  return rel.split("\\").join("/");
}

function startOfIsoWeekUtc(input: Date): Date {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeWeekStart(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return toIsoDate(startOfIsoWeekUtc(new Date()));
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("weekStart must be in YYYY-MM-DD format");
  }
  return toIsoDate(startOfIsoWeekUtc(parsed));
}

function buildWbrWeekTag(weekStart: string): string {
  return `${WBR_WEEK_TAG_PREFIX}${weekStart}`;
}

function hasTaskTag(task: Pick<Task, "tags">, tag: string): boolean {
  return task.tags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
}

function hasTagPrefix(task: Pick<Task, "tags">, prefix: string): boolean {
  return task.tags.some((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
}

function isWbrTask(task: Pick<Task, "title" | "tags">): boolean {
  return hasTaskTag(task, WBR_TAG) || /^wbr\b/i.test(task.title);
}

function isWbrTaskForWeek(task: Pick<Task, "title" | "tags">, weekStart: string): boolean {
  if (!isWbrTask(task)) {
    return false;
  }
  const weekTag = buildWbrWeekTag(weekStart);
  return hasTaskTag(task, weekTag) || task.title.includes(weekStart);
}

function toDepartmentTag(department: string): string {
  const slug = slugifyAliasSegment(department);
  return `${WBR_DEPARTMENT_TAG_PREFIX}${slug || "unknown"}`;
}

function departmentFromTags(task: Pick<Task, "tags">): string | null {
  const match = task.tags.find((entry) => entry.toLowerCase().startsWith(WBR_DEPARTMENT_TAG_PREFIX));
  if (!match) {
    return null;
  }
  const value = match.slice(WBR_DEPARTMENT_TAG_PREFIX.length).trim();
  if (!value) {
    return null;
  }
  return value
    .split("-")
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function assertStatusTransition(previousStatus: TaskStatus, nextStatus: TaskStatus): void {
  if (previousStatus === nextStatus) {
    return;
  }
  const allowed = TASK_STATUS_TRANSITIONS[previousStatus] ?? [];
  if (allowed.includes(nextStatus)) {
    return;
  }
  throw new Error(`invalid stage transition ${previousStatus} -> ${nextStatus}`);
}

function shouldUsePostgresState(): boolean {
  if (COMMAND_CENTER_DB_MODE === "file" || COMMAND_CENTER_DB_MODE === "json") {
    return false;
  }
  if (COMMAND_CENTER_DB_MODE === "postgres") {
    return true;
  }
  return Boolean(COMMAND_CENTER_DATABASE_URL || POSTGRES_HOST);
}

function resolvePostgresSsl(): false | { rejectUnauthorized: boolean } {
  if (!POSTGRES_SSL_MODE || POSTGRES_SSL_MODE === "disable" || POSTGRES_SSL_MODE === "allow" || POSTGRES_SSL_MODE === "prefer") {
    return false;
  }
  return { rejectUnauthorized: false };
}

function createPostgresPool(): Pool | null {
  if (!shouldUsePostgresState()) {
    return null;
  }

  const ssl = resolvePostgresSsl();
  if (COMMAND_CENTER_DATABASE_URL) {
    return new Pool({
      connectionString: COMMAND_CENTER_DATABASE_URL,
      ssl,
      max: 5,
    });
  }

  return new Pool({
    host: POSTGRES_HOST || "127.0.0.1",
    port: Number.isFinite(POSTGRES_PORT) ? POSTGRES_PORT : 5432,
    database: POSTGRES_DATABASE || "command_center",
    user: POSTGRES_USER || "command_center",
    password: POSTGRES_PASSWORD,
    ssl,
    max: 5,
  });
}

interface StatePersistence {
  load(): Promise<DashboardState | null>;
  save(state: DashboardState): Promise<void>;
}

class FileStatePersistence implements StatePersistence {
  constructor(private readonly filePath: string) {}

  async load(): Promise<DashboardState | null> {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      return null;
    }

    const raw = await fs.readFile(this.filePath, "utf-8");
    const parsed = tryParseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const state = parsed as Partial<DashboardState>;
    return {
      tasks: Array.isArray(state.tasks) ? state.tasks as Task[] : [],
      activity: Array.isArray(state.activity) ? state.activity as ActivityEvent[] : [],
    };
  }

  async save(state: DashboardState): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tempFile, this.filePath);
  }
}

class PostgresStatePersistence implements StatePersistence {
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly bootstrapStateFilePath: string | null = STATE_FILE,
  ) {}

  private async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS command_center_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })();

    return this.initPromise;
  }

  async load(): Promise<DashboardState | null> {
    await this.init();
    const result = await this.pool.query<{ state: unknown }>(
      "SELECT state FROM command_center_state WHERE id = 1 LIMIT 1",
    );
    if (result.rows.length === 0) {
      const bootstrap = await this.readBootstrapState();
      if (bootstrap) {
        await this.save(bootstrap);
      }
      return bootstrap;
    }

    const raw = result.rows[0]?.state;
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const state = raw as Partial<DashboardState>;
    return {
      tasks: Array.isArray(state.tasks) ? state.tasks as Task[] : [],
      activity: Array.isArray(state.activity) ? state.activity as ActivityEvent[] : [],
    };
  }

  private async readBootstrapState(): Promise<DashboardState | null> {
    if (!this.bootstrapStateFilePath || !existsSync(this.bootstrapStateFilePath)) {
      return null;
    }

    try {
      const raw = await fs.readFile(this.bootstrapStateFilePath, "utf-8");
      const parsed = tryParseJson(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const state = parsed as Partial<DashboardState>;
      return {
        tasks: Array.isArray(state.tasks) ? state.tasks as Task[] : [],
        activity: Array.isArray(state.activity) ? state.activity as ActivityEvent[] : [],
      };
    } catch {
      return null;
    }
  }

  async save(state: DashboardState): Promise<void> {
    await this.init();
    await this.pool.query(
      `
      INSERT INTO command_center_state (id, state, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
      `,
      [JSON.stringify(state)],
    );
  }
}

function createStatePersistence(filePath: string): StatePersistence {
  const pool = createPostgresPool();
  if (pool) {
    return new PostgresStatePersistence(pool);
  }
  return new FileStatePersistence(filePath);
}

class StateStore {
  private state: DashboardState = { tasks: [], activity: [] };
  private chain: Promise<unknown> = Promise.resolve();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly persistence: StatePersistence) {}

  async getSnapshot(): Promise<DashboardState> {
    await this.init();
    const cloned = structuredClone(this.state);
    cloned.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    cloned.activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return cloned;
  }

  async createTask(input: CreateTaskInput, actorMatrixId: string): Promise<Task> {
    await this.init();
    return this.enqueue(async () => {
      const now = new Date().toISOString();
      const taskId = `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const blockedReason = sanitizeOptionalText(input.blockedReason);
      const nextAction = sanitizeOptionalText(input.nextAction);
      const blockerOwnerMatrixId = normalizeNullableMatrixId(input.blockerOwnerMatrixId ?? null);
      const escalateToMatrixId = normalizeNullableMatrixId(input.escalateToMatrixId ?? null);
      const task: Task = {
        id: taskId,
        title: input.title.trim(),
        description: (input.description ?? "").trim(),
        workItemType: input.workItemType ?? "task",
        parentTaskId: this.resolveParentTaskId(taskId, input.parentTaskId ?? null),
        status: "inbox",
        priority: input.priority ?? "medium",
        creatorMatrixId: actorMatrixId,
        assigneeMatrixId: normalizeNullableMatrixId(input.assigneeMatrixId ?? null),
        tags: sanitizeTags(input.tags ?? []),
        deliverable: sanitizeRequiredText(input.deliverable, "deliverable"),
        blockedReason,
        blockerOwnerMatrixId,
        escalateToMatrixId,
        nextAction,
        ownerMatrixId: null,
        ownerName: "Unknown",
        department: "Unknown",
        departments: [],
        team: "Unknown",
        vp: "Unknown",
        director: "Unknown",
        manager: "Unknown",
        matrixRoomId: null,
        matrixThreadRootEventId: null,
        createdAt: now,
        updatedAt: now,
        comments: [],
        attachments: [],
      };

      this.state.tasks.push(task);
      this.recordActivity({
        type: "task_created",
        actorMatrixId,
        taskId: task.id,
        message: `${actorMatrixId} created ${task.id}`,
      });

      return task;
    });
  }

  async updateTask(taskId: string, input: UpdateTaskInput, actorMatrixId: string): Promise<Task> {
    await this.init();
    return this.enqueue(async () => {
      const task = this.state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error("Task not found");
      }

      const previousStatus = task.status;
      const previousPriority = task.priority;
      const previousAssignee = task.assigneeMatrixId;
      const previousParentTaskId = task.parentTaskId;
      const previousWorkItemType = task.workItemType;
      const previousBlockedReason = task.blockedReason;
      const previousNextAction = task.nextAction;
      const previousBlockerOwner = task.blockerOwnerMatrixId;
      const previousEscalateTo = task.escalateToMatrixId;

      if (typeof input.title === "string") {
        task.title = input.title.trim();
      }
      if (typeof input.description === "string") {
        task.description = input.description.trim();
      }
      if (input.workItemType && TASK_WORK_ITEM_TYPES.includes(input.workItemType)) {
        task.workItemType = input.workItemType;
      }
      if (input.status && TASK_STATUSES.includes(input.status)) {
        assertStatusTransition(task.status, input.status);
        task.status = input.status;
      }
      if (input.priority && TASK_PRIORITIES.includes(input.priority)) {
        task.priority = input.priority;
      }
      if (Object.prototype.hasOwnProperty.call(input, "assigneeMatrixId")) {
        task.assigneeMatrixId = normalizeNullableMatrixId(input.assigneeMatrixId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(input, "parentTaskId")) {
        task.parentTaskId = this.resolveParentTaskId(task.id, input.parentTaskId ?? null);
      }
      if (Array.isArray(input.tags)) {
        task.tags = sanitizeTags(input.tags);
      }
      if (Object.prototype.hasOwnProperty.call(input, "deliverable")) {
        task.deliverable = sanitizeRequiredText(input.deliverable ?? "", "deliverable");
      }
      if (Object.prototype.hasOwnProperty.call(input, "blockedReason")) {
        task.blockedReason = sanitizeOptionalText(input.blockedReason);
      }
      if (Object.prototype.hasOwnProperty.call(input, "nextAction")) {
        task.nextAction = sanitizeOptionalText(input.nextAction);
      }
      if (Object.prototype.hasOwnProperty.call(input, "blockerOwnerMatrixId")) {
        task.blockerOwnerMatrixId = normalizeNullableMatrixId(input.blockerOwnerMatrixId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(input, "escalateToMatrixId")) {
        task.escalateToMatrixId = normalizeNullableMatrixId(input.escalateToMatrixId ?? null);
      }

      if (task.status === "blocked") {
        if (!task.blockedReason) {
          throw new Error("blockedReason is required when status is blocked");
        }
        if (!task.nextAction) {
          throw new Error("nextAction is required when status is blocked");
        }
      } else if (previousStatus === "blocked") {
        if (!Object.prototype.hasOwnProperty.call(input, "blockedReason")) {
          task.blockedReason = null;
        }
        if (!Object.prototype.hasOwnProperty.call(input, "nextAction")) {
          task.nextAction = null;
        }
        if (!Object.prototype.hasOwnProperty.call(input, "blockerOwnerMatrixId")) {
          task.blockerOwnerMatrixId = null;
        }
        if (!Object.prototype.hasOwnProperty.call(input, "escalateToMatrixId")) {
          task.escalateToMatrixId = null;
        }
      }

      task.updatedAt = new Date().toISOString();

      const changeSummary = [
        previousWorkItemType !== task.workItemType ? `type ${previousWorkItemType} -> ${task.workItemType}` : null,
        previousStatus !== task.status ? `status ${previousStatus} -> ${task.status}` : null,
        previousPriority !== task.priority ? `priority ${previousPriority} -> ${task.priority}` : null,
        previousAssignee !== task.assigneeMatrixId
          ? `assignee ${previousAssignee ?? "none"} -> ${task.assigneeMatrixId ?? "none"}`
          : null,
        previousParentTaskId !== task.parentTaskId
          ? `parent ${previousParentTaskId ?? "none"} -> ${task.parentTaskId ?? "none"}`
          : null,
        previousBlockedReason !== task.blockedReason ? "blocked reason updated" : null,
        previousNextAction !== task.nextAction ? "next action updated" : null,
        previousBlockerOwner !== task.blockerOwnerMatrixId ? "blocker owner updated" : null,
        previousEscalateTo !== task.escalateToMatrixId ? "escalation target updated" : null,
      ]
        .filter((entry): entry is string => entry !== null)
        .join(", ");

      if (previousStatus !== task.status) {
        task.comments.push({
          id: `comment_${Date.now()}_${randomUUID().slice(0, 8)}`,
          authorMatrixId: actorMatrixId,
          message: `[UPDATE] Status changed: ${previousStatus} -> ${task.status}`,
          createdAt: task.updatedAt,
        });
      }

      this.recordActivity({
        type: "task_updated",
        actorMatrixId,
        taskId: task.id,
        message: changeSummary.length > 0 ? changeSummary : `${actorMatrixId} updated ${task.id}`,
      });

      return task;
    });
  }

  async updateTaskContext(
    taskId: string,
    input: {
      ownerMatrixId?: string | null;
      ownerName?: string | null;
      department?: string | null;
      departments?: string[] | null;
      team?: string | null;
      vp?: string | null;
      director?: string | null;
      manager?: string | null;
      matrixRoomId?: string | null;
      matrixThreadRootEventId?: string | null;
    },
  ): Promise<Task> {
    await this.init();
    return this.enqueue(async () => {
      const task = this.state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error("Task not found");
      }

      if (Object.prototype.hasOwnProperty.call(input, "ownerMatrixId")) {
        task.ownerMatrixId = normalizeNullableMatrixId(input.ownerMatrixId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(input, "ownerName")) {
        task.ownerName = sanitizeOptionalText(input.ownerName ?? null) ?? "Unknown";
      }
      if (Object.prototype.hasOwnProperty.call(input, "department")) {
        task.department = sanitizeOptionalText(input.department ?? null) ?? "Unknown";
      }
      if (Object.prototype.hasOwnProperty.call(input, "departments")) {
        const values = Array.isArray(input.departments)
          ? input.departments.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
          : [];
        task.departments = Array.from(new Set(values));
      }
      if (Object.prototype.hasOwnProperty.call(input, "team")) {
        task.team = sanitizeOptionalText(input.team ?? null) ?? "Unknown";
      }
      if (Object.prototype.hasOwnProperty.call(input, "vp")) {
        task.vp = sanitizeOptionalText(input.vp ?? null) ?? "Unknown";
      }
      if (Object.prototype.hasOwnProperty.call(input, "director")) {
        task.director = sanitizeOptionalText(input.director ?? null) ?? "Unknown";
      }
      if (Object.prototype.hasOwnProperty.call(input, "manager")) {
        task.manager = sanitizeOptionalText(input.manager ?? null) ?? "Unknown";
      }
      if (Object.prototype.hasOwnProperty.call(input, "matrixRoomId")) {
        task.matrixRoomId = sanitizeOptionalText(input.matrixRoomId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(input, "matrixThreadRootEventId")) {
        task.matrixThreadRootEventId = sanitizeOptionalText(input.matrixThreadRootEventId ?? null);
      }

      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  private resolveParentTaskId(taskId: string, parentTaskId: string | null): string | null {
    const normalizedParentTaskId = String(parentTaskId ?? "").trim();
    if (!normalizedParentTaskId) {
      return null;
    }

    if (normalizedParentTaskId === taskId) {
      throw new Error("A task cannot be its own parent");
    }

    const parentTask = this.state.tasks.find((candidate) => candidate.id === normalizedParentTaskId);
    if (!parentTask) {
      throw new Error(`parentTaskId '${normalizedParentTaskId}' does not exist`);
    }

    const visited = new Set<string>();
    let cursor: Task | null = parentTask;
    while (cursor) {
      if (cursor.id === taskId) {
        throw new Error("parentTaskId creates a cycle");
      }

      if (!cursor.parentTaskId || visited.has(cursor.parentTaskId)) {
        break;
      }

      const nextParentTaskId: string = cursor.parentTaskId;
      visited.add(nextParentTaskId);
      cursor = this.state.tasks.find((candidate) => candidate.id === nextParentTaskId) ?? null;
    }

    return normalizedParentTaskId;
  }

  async addComment(taskId: string, message: string, actorMatrixId: string): Promise<Task> {
    await this.init();
    return this.enqueue(async () => {
      const task = this.state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error("Task not found");
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
        type: "comment_added",
        actorMatrixId,
        taskId: task.id,
        message: `${actorMatrixId} commented on ${task.id}`,
      });

      return task;
    });
  }

  async addAttachment(taskId: string, input: AddTaskAttachmentInput, actorMatrixId: string): Promise<Task> {
    await this.init();
    return this.enqueue(async () => {
      const task = this.state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error("Task not found");
      }

      mkdirSync(SHARED_FILES_ROOT, { recursive: true });

      const nowIso = new Date().toISOString();
      const attachmentId = `attachment_${Date.now()}_${randomUUID().slice(0, 8)}`;
      let fileName = "attachment";
      let contentType = "application/octet-stream";
      let sizeBytes = 0;
      let sharedPath = "";
      let sourceKind: "upload" | "link" = "upload";

      if (input.kind === "upload") {
        const bytes = input.data ?? new Uint8Array();
        sizeBytes = bytes.byteLength;
        if (sizeBytes <= 0) {
          throw new Error("Attachment file is empty");
        }
        if (Number.isFinite(MAX_ATTACHMENT_BYTES) && sizeBytes > MAX_ATTACHMENT_BYTES) {
          throw new Error(`Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`);
        }

        fileName = sanitizeFileName(input.fileName);
        contentType = (input.contentType || "").trim() || contentTypeFromFileName(fileName);
        sharedPath = `tasks/${task.id}/${Date.now()}_${randomUUID().slice(0, 6)}_${fileName}`.replace(/\\/g, "/");
        const absolutePath = resolve(SHARED_FILES_ROOT, sharedPath);
        await fs.mkdir(dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, Buffer.from(bytes));
        sourceKind = "upload";
      } else {
        const normalized = normalizeSharedPath(input.sharedPath);
        const absolutePath = resolve(SHARED_FILES_ROOT, normalized);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat || !stat.isFile()) {
          throw new Error(`Linked file not found: ${input.sharedPath}`);
        }

        sizeBytes = Number.isFinite(stat.size) ? stat.size : 0;
        fileName = sanitizeFileName(input.fileName ?? basename(normalized));
        contentType = (input.contentType || "").trim() || contentTypeFromFileName(fileName);
        sharedPath = normalized;
        sourceKind = "link";
      }

      const attachment: TaskAttachment = {
        id: attachmentId,
        fileName,
        contentType,
        sizeBytes,
        sharedPath,
        sourceKind,
        createdAt: nowIso,
        createdByMatrixId: actorMatrixId,
      };

      task.attachments.push(attachment);
      task.updatedAt = nowIso;
      this.recordActivity({
        type: "task_updated",
        actorMatrixId,
        taskId: task.id,
        message: `${actorMatrixId} attached ${attachment.fileName} to ${task.id}`,
      });

      return task;
    });
  }

  private async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const loaded = await this.persistence.load().catch(() => null);
      if (!loaded) {
        await this.persist();
        return;
      }

      this.state = {
        tasks: Array.isArray(loaded.tasks) ? loaded.tasks.map((task) => this.normalizeTask(task)) : [],
        activity: Array.isArray(loaded.activity)
          ? loaded.activity
              .filter((entry): entry is ActivityEvent => Boolean(entry && typeof entry === "object" && "id" in entry))
          : [],
      };
    })();

    return this.initPromise;
  }

  private normalizeTask(input: unknown): Task {
    const candidate = (input ?? {}) as Partial<Task>;
    return {
      id: candidate.id ?? `task_legacy_${Date.now()}_${randomUUID().slice(0, 8)}`,
      title: typeof candidate.title === "string" && candidate.title.trim().length > 0 ? candidate.title.trim() : "Untitled Task",
      description: typeof candidate.description === "string" ? candidate.description : "",
      workItemType: parseTaskWorkItemType((candidate as { workItemType?: unknown }).workItemType) ?? "task",
      parentTaskId: typeof candidate.parentTaskId === "string" && candidate.parentTaskId.trim().length > 0
        ? candidate.parentTaskId.trim()
        : null,
      status: TASK_STATUSES.includes(candidate.status as TaskStatus) ? (candidate.status as TaskStatus) : "inbox",
      priority: TASK_PRIORITIES.includes(candidate.priority as TaskPriority) ? (candidate.priority as TaskPriority) : "medium",
      creatorMatrixId: typeof candidate.creatorMatrixId === "string" ? candidate.creatorMatrixId : "@unknown:anycompany.corp",
      assigneeMatrixId: normalizeNullableMatrixId(candidate.assigneeMatrixId ?? null),
      tags: Array.isArray(candidate.tags) ? sanitizeTags(candidate.tags) : [],
      deliverable:
        typeof candidate.deliverable === "string" && candidate.deliverable.trim().length > 0
          ? candidate.deliverable.trim()
          : "Define expected deliverable",
      blockedReason: sanitizeOptionalText(candidate.blockedReason ?? null),
      blockerOwnerMatrixId: normalizeNullableMatrixId(candidate.blockerOwnerMatrixId ?? null),
      escalateToMatrixId: normalizeNullableMatrixId(candidate.escalateToMatrixId ?? null),
      nextAction: sanitizeOptionalText(candidate.nextAction ?? null),
      ownerMatrixId: normalizeNullableMatrixId(candidate.ownerMatrixId ?? null),
      ownerName:
        typeof candidate.ownerName === "string" && candidate.ownerName.trim().length > 0
          ? candidate.ownerName.trim()
          : "Unknown",
      department:
        typeof candidate.department === "string" && candidate.department.trim().length > 0
          ? candidate.department.trim()
          : "Unknown",
      departments: Array.isArray(candidate.departments)
        ? Array.from(new Set(candidate.departments.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)))
        : [],
      team: typeof candidate.team === "string" && candidate.team.trim().length > 0 ? candidate.team.trim() : "Unknown",
      vp: typeof candidate.vp === "string" && candidate.vp.trim().length > 0 ? candidate.vp.trim() : "Unknown",
      director:
        typeof candidate.director === "string" && candidate.director.trim().length > 0
          ? candidate.director.trim()
          : "Unknown",
      manager:
        typeof candidate.manager === "string" && candidate.manager.trim().length > 0
          ? candidate.manager.trim()
          : "Unknown",
      matrixRoomId: sanitizeOptionalText(candidate.matrixRoomId ?? null),
      matrixThreadRootEventId: sanitizeOptionalText(candidate.matrixThreadRootEventId ?? null),
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
      comments: Array.isArray(candidate.comments)
        ? candidate.comments
            .filter((comment): comment is TaskComment => Boolean(comment && typeof comment === "object" && "id" in comment))
            .map((comment) => ({
              id: String(comment.id),
              authorMatrixId: String(comment.authorMatrixId ?? "@unknown:anycompany.corp"),
              message: String(comment.message ?? ""),
              createdAt: String(comment.createdAt ?? new Date().toISOString()),
            }))
        : [],
      attachments: (() => {
        const raw = (candidate as { attachments?: unknown[] }).attachments;
        if (!Array.isArray(raw)) {
          return [];
        }
        return raw
          .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment && typeof attachment === "object"))
          .map((attachment): TaskAttachment => {
            const value = attachment as Partial<TaskAttachment>;
            return {
              id: typeof value.id === "string" ? value.id : `attachment_${Date.now()}_${randomUUID().slice(0, 8)}`,
              fileName: sanitizeFileName(typeof value.fileName === "string" ? value.fileName : "attachment"),
              contentType: typeof value.contentType === "string" && value.contentType.trim().length > 0
                ? value.contentType
                : "application/octet-stream",
              sizeBytes: typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes) ? Math.max(0, Math.floor(value.sizeBytes)) : 0,
              sharedPath: typeof value.sharedPath === "string" ? normalizeSharedPath(value.sharedPath) : "",
              sourceKind: value.sourceKind === "link" ? "link" : "upload",
              createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
              createdByMatrixId: typeof value.createdByMatrixId === "string" ? value.createdByMatrixId : "@unknown:anycompany.corp",
            };
          })
          .filter((entry) => entry.sharedPath.length > 0);
      })(),
    };
  }

  private recordActivity(event: Omit<ActivityEvent, "id" | "createdAt">): void {
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
    await this.persistence.save(this.state);
  }
}

class OrgDirectory {
  private cached: OrgData = { departments: [], people: [] };
  private cachedSourcePath: string | null = null;
  private cachedMtimeMs = -1;

  constructor(private readonly orgPath: string, private readonly deployedOrgPath: string | null = null) {}

  async getSnapshot(): Promise<OrgData> {
    const preferredPath = this.deployedOrgPath && existsSync(this.deployedOrgPath)
      ? this.deployedOrgPath
      : this.orgPath;

    if (!existsSync(preferredPath)) {
      this.cached = { departments: [], people: [] };
      this.cachedSourcePath = null;
      this.cachedMtimeMs = -1;
      return this.cached;
    }

    try {
      const stats = await fs.stat(preferredPath);
      if (this.cachedSourcePath === preferredPath && this.cachedMtimeMs === stats.mtimeMs) {
        if (preferredPath === this.orgPath) {
          const deployedMatrixIds = await listDeployedAgentMatrixIds();
          if (deployedMatrixIds.size === 0) {
            return this.cached;
          }
          return scopeOrgToDeployed(this.cached, deployedMatrixIds);
        }
        return this.cached;
      }

      const raw = await fs.readFile(preferredPath, "utf-8");
      this.cached = normalizeOrgData(tryParseJson(raw));
      this.cachedSourcePath = preferredPath;
      this.cachedMtimeMs = stats.mtimeMs;

      if (preferredPath !== this.orgPath) {
        return this.cached;
      }

      const deployedMatrixIds = await listDeployedAgentMatrixIds();
      if (deployedMatrixIds.size === 0) {
        return this.cached;
      }

      return scopeOrgToDeployed(this.cached, deployedMatrixIds);
    } catch {
      return this.cached;
    }
  }
}

class EventHub {
  private readonly clients = new Map<string, SseClient>();

  addClient(client: SseClient): void {
    this.clients.set(client.id, client);
    this.emitToClient(client, "connected", { ok: true });
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }
    this.clients.delete(clientId);
    client.close();
  }

  emit(eventName: string, payload: unknown): void {
    for (const client of this.clients.values()) {
      this.emitToClient(client, eventName, payload);
    }
  }

  private emitToClient(client: SseClient, eventName: string, payload: unknown): void {
    try {
      client.send(eventName, payload);
    } catch {
      this.clients.delete(client.id);
      client.close();
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
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return null;
  }

  const teams = Array.isArray(candidate.teams)
    ? candidate.teams.map((team) => String(team).trim()).filter((team) => team.length > 0)
    : [];

  return {
    name: candidate.name.trim(),
    vp: typeof candidate.vp === "string" ? candidate.vp.trim() : "",
    teams: Array.from(new Set(teams)),
    headcount:
      typeof candidate.headcount === "number" && Number.isFinite(candidate.headcount)
        ? Math.max(0, Math.trunc(candidate.headcount))
        : 0,
  };
}

function normalizeOrgPerson(input: unknown): OrgPerson | null {
  const candidate = (input ?? {}) as Partial<OrgPerson>;
  if (typeof candidate.matrixId !== "string" || candidate.matrixId.trim().length === 0) {
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
    name: typeof candidate.name === "string" && candidate.name.trim().length > 0 ? candidate.name.trim() : normalizedMatrixId,
    title: typeof candidate.title === "string" && candidate.title.trim().length > 0 ? candidate.title.trim() : "Agent",
    level: typeof candidate.level === "string" && candidate.level.trim().length > 0 ? candidate.level.trim() : "IC",
    department:
      typeof candidate.department === "string" && candidate.department.trim().length > 0
        ? candidate.department.trim()
        : "Unassigned",
    team: typeof candidate.team === "string" && candidate.team.trim().length > 0 ? candidate.team.trim() : null,
    matrixId: normalizedMatrixId,
    reportsTo: normalizeNullableMatrixId(candidate.reportsTo ?? null),
    directReports: Array.from(new Set(directReports)),
  };
}

function scopeOrgToDeployed(org: OrgData, deployedMatrixIds: Set<string>): OrgData {
  const allowedMatrixIds = new Set<string>();
  for (const person of org.people) {
    if (deployedMatrixIds.has(person.matrixId) || person.level.toLowerCase() === "ceo") {
      allowedMatrixIds.add(person.matrixId);
    }
  }

  const people = org.people
    .filter((person) => allowedMatrixIds.has(person.matrixId))
    .map((person) => ({
      ...person,
      reportsTo: person.reportsTo && allowedMatrixIds.has(person.reportsTo) ? person.reportsTo : null,
      directReports: person.directReports.filter((entry) => allowedMatrixIds.has(entry)),
    }));

  const departmentMap = new Map<string, { vp: string; teams: Set<string>; headcount: number }>();
  for (const person of people) {
    const name = person.department || "Unassigned";
    const current = departmentMap.get(name) ?? { vp: "", teams: new Set<string>(), headcount: 0 };
    current.headcount += 1;
    if (person.team) {
      current.teams.add(person.team);
    }
    if (!current.vp && person.level.toLowerCase() === "vp") {
      current.vp = person.matrixId;
    }
    departmentMap.set(name, current);
  }

  const departments = Array.from(departmentMap.entries())
    .map(([name, value]) => ({
      name,
      vp: value.vp,
      teams: Array.from(value.teams).sort((a, b) => a.localeCompare(b)),
      headcount: value.headcount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { departments, people };
}

function formatOrgPerson(person: OrgPerson): string {
  return `${person.name} | ${person.title} | ${person.department}${person.team ? `/${person.team}` : ""} | ${person.matrixId}`;
}

function queryPeopleDirectory(org: OrgData, action: PeopleAction, queryRaw: string, limitRaw: number): string[] {
  const query = queryRaw.trim();
  const lowered = query.toLowerCase();
  const limit = Math.max(1, Math.min(MAX_PEOPLE_QUERY_LIMIT, Math.trunc(limitRaw || 10)));
  const byMatrixId = new Map(org.people.map((person) => [person.matrixId, person]));

  switch (action) {
    case "search":
      return org.people
        .filter((person) => {
          if (!lowered) {
            return true;
          }
          return (
            person.name.toLowerCase().includes(lowered)
            || person.title.toLowerCase().includes(lowered)
            || person.department.toLowerCase().includes(lowered)
            || (person.team?.toLowerCase().includes(lowered) ?? false)
            || person.matrixId.toLowerCase().includes(lowered)
          );
        })
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case "find": {
      const matrixId = parseActorMatrixId(query);
      if (!matrixId) {
        return [];
      }
      const person = byMatrixId.get(matrixId);
      return person ? [formatOrgPerson(person)] : [];
    }
    case "department":
      return org.people
        .filter((person) => person.department.toLowerCase() === lowered)
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case "team":
      return org.people
        .filter((person) => (person.team ?? "").toLowerCase() === lowered)
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case "title":
      return org.people
        .filter((person) => person.title.toLowerCase().includes(lowered))
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case "level":
      return org.people
        .filter((person) => person.level.toLowerCase() === lowered)
        .slice(0, limit)
        .map((person) => formatOrgPerson(person));
    case "manager": {
      const matrixId = parseActorMatrixId(query);
      if (!matrixId) {
        return [];
      }
      const person = byMatrixId.get(matrixId);
      if (!person?.reportsTo) {
        return [];
      }
      const manager = byMatrixId.get(person.reportsTo);
      return manager ? [formatOrgPerson(manager)] : [];
    }
    case "reports": {
      const matrixId = parseActorMatrixId(query);
      if (!matrixId) {
        return [];
      }
      const person = byMatrixId.get(matrixId);
      if (!person) {
        return [];
      }
      return person.directReports
        .map((entry) => byMatrixId.get(entry))
        .filter((entry): entry is OrgPerson => entry !== undefined)
        .slice(0, limit)
        .map((entry) => formatOrgPerson(entry));
    }
    case "chain": {
      const matrixId = parseActorMatrixId(query);
      if (!matrixId) {
        return [];
      }
      const person = byMatrixId.get(matrixId);
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
    case "list":
      if (lowered === "departments") {
        return org.departments.map((department) => `${department.name} (${department.headcount} people)`);
      }
      if (lowered === "teams") {
        return Array.from(
          new Set(org.people.map((person) => person.team).filter((team): team is string => Boolean(team))),
        ).sort();
      }
      if (lowered === "titles") {
        return Array.from(new Set(org.people.map((person) => person.title))).sort().slice(0, limit);
      }
      if (lowered === "levels") {
        return Array.from(new Set(org.people.map((person) => person.level))).sort().slice(0, limit);
      }
      return [];
    default:
      return [];
  }
}

function buildAgentStatusMap(tasks: Task[]): Map<string, "working" | "idle"> {
  const map = new Map<string, "working" | "idle">();

  for (const task of tasks) {
    if (!task.assigneeMatrixId) {
      continue;
    }

    const working = task.status === "assigned" || task.status === "in_progress" || task.status === "review";
    if (working) {
      map.set(task.assigneeMatrixId, "working");
    } else if (!map.has(task.assigneeMatrixId)) {
      map.set(task.assigneeMatrixId, "idle");
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
      if (!department.isDirectory() || department.name.startsWith(".")) {
        continue;
      }

      const departmentPath = join(WORKSPACES_ROOT, department.name);
      const agentDirs = await fs.readdir(departmentPath, { withFileTypes: true });
      for (const agent of agentDirs) {
        if (!agent.isDirectory() || agent.name.startsWith(".")) {
          continue;
        }

        const workspacePath = join(departmentPath, agent.name);
        if (!existsSync(join(workspacePath, "openclaw.json"))) {
          continue;
        }

        deployed.add(normalizeMatrixId(`@${agent.name}:${MATRIX_DOMAIN}`));
      }
    }
  } catch {
    // fall through to org/task-derived data
  }

  return deployed;
}

async function matrixRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
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
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payloadText = await response.text();
  const payload = payloadText.length > 0 ? tryParseJson(payloadText) : {};

  if (!response.ok) {
    const details = typeof payload === "object" && payload !== null ? JSON.stringify(payload) : payloadText;
    throw new Error(`Matrix request failed (${response.status}): ${details}`);
  }

  return payload as T;
}

async function loginToMatrix(matrixId: string, password: string): Promise<{ accessToken: string; userId: string }> {
  const normalizedId = normalizeMatrixId(matrixId);
  const username = normalizedId.split(":")[0].slice(1);

  const payload = {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: username },
    password,
  };

  try {
    const response = await matrixRequest<{ access_token: string; user_id: string }>("/_matrix/client/v3/login", "POST", {
      body: payload,
    });

    return {
      accessToken: response.access_token,
      userId: response.user_id,
    };
  } catch {
    const fallback = await matrixRequest<{ access_token: string; user_id: string }>("/_matrix/client/r0/login", "POST", {
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
    throw new Error("MATRIX_PASSWORD_SEED is not configured");
  }

  return createHmac("sha256", MATRIX_PASSWORD_SEED).update(normalizeMatrixId(matrixId)).digest("hex").slice(0, 32);
}

async function registerMatrixUser(matrixId: string, password: string): Promise<void> {
  const normalizedId = normalizeMatrixId(matrixId);
  const username = normalizedId.split(":")[0].slice(1);

  try {
    await matrixRequest("/_matrix/client/v3/register", "POST", {
      body: {
        username,
        password,
        auth: { type: "m.login.dummy" },
      },
    });
  } catch {
    await matrixRequest("/_matrix/client/r0/register", "POST", {
      body: {
        username,
        password,
        auth: { type: "m.login.dummy" },
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
    return {
      userId: login.userId,
      accessToken: login.accessToken,
      homeserver: MATRIX_HOMESERVER,
    };
  } catch {
    try {
      await registerMatrixUser(matrixId, password);
      const login = await loginToMatrix(matrixId, password);
      return {
        userId: login.userId,
        accessToken: login.accessToken,
        homeserver: MATRIX_HOMESERVER,
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

async function resolveNotificationSession(actorMatrixId: string): Promise<UserSession | null> {
  const botMatrixId = getTaskAssignmentBotMatrixId();
  if (botMatrixId) {
    const botSession = await createActorSession(botMatrixId);
    if (botSession) {
      return botSession;
    }
  }

  return await createActorSession(actorMatrixId);
}

async function ensureDirectRoomWithUser(session: UserSession, peerMatrixId: string): Promise<string> {
  const normalizedPeer = normalizeMatrixId(peerMatrixId);

  let directMap: Record<string, string[]> = {};
  try {
    const payload = await matrixRequest<unknown>(
      `/_matrix/client/r0/user/${encodeURIComponent(session.userId)}/account_data/m.direct`,
      "GET",
      {
        accessToken: session.accessToken,
        homeserver: session.homeserver,
      },
    );
    if (typeof payload === "object" && payload !== null) {
      directMap = payload as Record<string, string[]>;
    }
  } catch {
    directMap = {};
  }

  const existingRoomIds = Array.isArray(directMap[normalizedPeer]) ? directMap[normalizedPeer] : [];
  if (existingRoomIds.length > 0) {
    return existingRoomIds[0];
  }

  const created = await matrixRequest<{ room_id: string }>("/_matrix/client/r0/createRoom", "POST", {
    accessToken: session.accessToken,
    homeserver: session.homeserver,
    body: {
      is_direct: true,
      invite: [normalizedPeer],
      preset: "trusted_private_chat",
      name: "Task Assignments",
    },
  });

  const updated = {
    ...directMap,
    [normalizedPeer]: Array.from(new Set([...(directMap[normalizedPeer] ?? []), created.room_id])),
  };

  await matrixRequest(`/_matrix/client/r0/user/${encodeURIComponent(session.userId)}/account_data/m.direct`, "PUT", {
    accessToken: session.accessToken,
    homeserver: session.homeserver,
    body: updated,
  });

  return created.room_id;
}

function slugifyAliasSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveTaskTeamRoomAlias(task: Pick<Task, "team" | "department">): string | null {
  const team = slugifyAliasSegment(task.team ?? "");
  if (team && team !== "unknown") {
    return `${team}-team`;
  }

  const department = slugifyAliasSegment(task.department ?? "");
  if (department && department !== "unknown" && department !== "cross-department") {
    return `${department}-leadership`;
  }

  return null;
}

async function ensureTeamRoomForTaskThread(session: UserSession, task: Pick<Task, "team" | "department">): Promise<string | null> {
  const alias = resolveTaskTeamRoomAlias(task);
  if (!alias) {
    return null;
  }

  try {
    const payload = await matrixRequest<{ room_id: string }>(
      `/_matrix/client/r0/join/${encodeURIComponent(`#${alias}:${MATRIX_DOMAIN}`)}`,
      "POST",
      {
        accessToken: session.accessToken,
        homeserver: session.homeserver,
        body: {},
      },
    );
    return payload.room_id;
  } catch {
    return null;
  }
}

async function sendMatrixMessage(
  session: UserSession,
  roomId: string,
  message: string,
  threadRootEventId?: string | null,
): Promise<string> {
  const body: Record<string, unknown> = {
    msgtype: "m.text",
    body: message,
  };

  if (threadRootEventId) {
    body["m.relates_to"] = {
      rel_type: "m.thread",
      event_id: threadRootEventId,
      is_falling_back: true,
      "m.in_reply_to": {
        event_id: threadRootEventId,
      },
    };
  }

  const payload = await matrixRequest<{ event_id: string }>(
    `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
    "PUT",
    {
      accessToken: session.accessToken,
      homeserver: session.homeserver,
      body,
    },
  );

  return payload.event_id;
}

async function notifyAssigneeForTask(
  actorMatrixId: string,
  task: TaskView,
  assigneeMatrixId: string,
  reason: "created" | "reassigned",
): Promise<{
  sent: boolean;
  error: string | null;
  matrixRoomId: string | null;
  matrixThreadRootEventId: string | null;
  directRoomId: string | null;
}> {
  const assignee = normalizeMatrixId(assigneeMatrixId);
  const actor = normalizeMatrixId(actorMatrixId);

  const session = await resolveNotificationSession(actor);
  if (!session) {
    return {
      sent: false,
      error: "Unable to establish Matrix session for assignment notification",
      matrixRoomId: null,
      matrixThreadRootEventId: null,
      directRoomId: null,
    };
  }

  const action = reason === "created" ? "New task assigned" : "Task reassigned";
  const boardTaskUrl = `${COMMAND_CENTER_PUBLIC_URL}/tasks`;
  const messageLines = [
    `${action}: ${task.title}`,
    `Task ID: ${task.id}`,
    `Creator: ${task.creatorMatrixId}`,
    `Assignee: ${assignee}`,
    `Status: ${task.status}`,
    `Type: ${task.workItemType}`,
    `Priority: ${task.priority}`,
    `Deliverable: ${task.deliverable}`,
    task.description ? `Description: ${task.description}` : null,
    task.parentTaskId ? `Parent: ${task.parentTaskId}` : null,
    `Owner chain: VP=${task.vp} | Director=${task.director} | Manager=${task.manager}`,
    "",
    `Team thread: ${task.team !== "Unknown" ? task.team : task.department}`,
    `Please post progress/blockers in this task thread and mirror key updates on task comments (${task.id}).`,
    "",
    "Next steps:",
    `1) Track updates in Command Center task board: ${boardTaskUrl}`,
    `2) Post progress/blockers in task comments on ${task.id}`,
    `3) Coordinate directly with creator: ${task.creatorMatrixId}`,
  ].filter((line): line is string => line !== null);

  let sent = false;
  let matrixRoomId = sanitizeOptionalText(task.matrixRoomId ?? null);
  let matrixThreadRootEventId = sanitizeOptionalText(task.matrixThreadRootEventId ?? null);
  let directRoomId: string | null = null;
  const errors: string[] = [];

  try {
    if (!matrixRoomId) {
      matrixRoomId = await ensureTeamRoomForTaskThread(session, task);
    }

    if (matrixRoomId) {
      const threadEventId = await sendMatrixMessage(session, matrixRoomId, messageLines.join("\n"), matrixThreadRootEventId);
      if (!matrixThreadRootEventId) {
        matrixThreadRootEventId = threadEventId;
      }
      sent = true;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to notify task team thread");
  }

  try {
    if (assignee !== actor) {
      directRoomId = await ensureDirectRoomWithUser(session, assignee);
      const dmLines = [
        `${action}: ${task.title}`,
        `Task ID: ${task.id}`,
        `Creator: ${task.creatorMatrixId}`,
        `Board: ${boardTaskUrl}`,
      ];
      await sendMatrixMessage(session, directRoomId, dmLines.join("\n"));
      sent = true;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to notify assignee via Matrix DM");
  }

  return {
    sent,
    error: errors.length > 0 ? errors.join(" | ") : null,
    matrixRoomId,
    matrixThreadRootEventId,
    directRoomId,
  };
}

async function notifyVpForWbrReview(
  actorMatrixId: string,
  task: TaskView,
  vpMatrixId: string,
): Promise<{
  sent: boolean;
  error: string | null;
  directRoomId: string | null;
}> {
  const vpId = normalizeMatrixId(vpMatrixId);
  const session = await resolveNotificationSession(actorMatrixId);
  if (!session) {
    return {
      sent: false,
      error: "Unable to establish Matrix session for VP notification",
      directRoomId: null,
    };
  }

  const boardTaskUrl = `${COMMAND_CENTER_PUBLIC_URL}/tasks`;
  const weekTag = task.tags.find((entry) => entry.toLowerCase().startsWith(WBR_WEEK_TAG_PREFIX)) ?? "week:unknown";
  const messageLines = [
    "WBR submission ready for VP review",
    `Task: ${task.title}`,
    `Task ID: ${task.id}`,
    `Week: ${weekTag.replace(WBR_WEEK_TAG_PREFIX, "")}`,
    `Department: ${task.department}`,
    `Director: ${task.assigneeMatrixId ?? task.ownerMatrixId ?? "Unknown"}`,
    `Status: ${task.status}`,
    `Deliverable: ${task.deliverable}`,
    "",
    `Review in Command Center: ${boardTaskUrl}`,
  ];

  try {
    const roomId = await ensureDirectRoomWithUser(session, vpId);
    await sendMatrixMessage(session, roomId, messageLines.join("\n"));
    return {
      sent: true,
      error: null,
      directRoomId: roomId,
    };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Failed to notify VP",
      directRoomId: null,
    };
  }
}

function toTaskContextPatch(task: TaskView): {
  ownerMatrixId: string | null;
  ownerName: string;
  department: string;
  departments: string[];
  team: string;
  vp: string;
  director: string;
  manager: string;
} {
  return {
    ownerMatrixId: task.ownerMatrixId,
    ownerName: task.ownerName,
    department: task.department,
    departments: task.departments,
    team: task.team,
    vp: task.vp,
    director: task.director,
    manager: task.manager,
  };
}

class CommandCenterBackend {
  private readonly stateStore = new StateStore(createStatePersistence(STATE_FILE));
  private readonly orgDirectory = new OrgDirectory(ORG_FILE_PATH, ORG_DEPLOYED_FILE_PATH);
  private readonly eventHub = new EventHub();
  private keepaliveStarted = false;

  constructor() {
    this.startKeepalive();
  }

  isServiceAuthorized(headers: Headers): boolean {
    if (!COMMAND_CENTER_API_TOKEN) {
      return true;
    }

    const headerToken =
      (headers.get(COMMAND_CENTER_API_TOKEN_HEADER) ?? "").trim()
      || (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

    return Boolean(headerToken && headerToken === COMMAND_CENTER_API_TOKEN);
  }

  async listTasks(options: {
    status?: string | null;
    workItemType?: string | null;
    parentTaskId?: string | null;
    includeDone?: string | null;
    assigneeMatrixId?: string | null;
    creatorMatrixId?: string | null;
    query?: string | null;
    limit?: string | null;
  }): Promise<{ count: number; total: number; limit: number; tasks: TaskView[] }> {
    const snapshot = await this.stateStore.getSnapshot();
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    let tasks = snapshot.tasks;

    const status = parseTaskStatus(options.status);
    if (options.status !== undefined && options.status !== null && status === null) {
      throw new Error(`invalid status. Supported statuses: ${TASK_STATUSES.join(", ")}`);
    }
    if (status) {
      tasks = tasks.filter((task) => task.status === status);
    }

    const workItemType = parseTaskWorkItemType(options.workItemType);
    if (options.workItemType !== undefined && options.workItemType !== null && workItemType === null) {
      throw new Error(`invalid workItemType. Supported types: ${TASK_WORK_ITEM_TYPES.join(", ")}`);
    }
    if (workItemType) {
      tasks = tasks.filter((task) => task.workItemType === workItemType);
    }

    if (options.parentTaskId !== undefined && options.parentTaskId !== null) {
      const parentTaskId = String(options.parentTaskId).trim();
      if (!parentTaskId || parentTaskId.toLowerCase() === "none") {
        tasks = tasks.filter((task) => task.parentTaskId === null);
      } else {
        tasks = tasks.filter((task) => task.parentTaskId === parentTaskId);
      }
    }

    const includeDoneRaw = String(options.includeDone ?? "true").trim().toLowerCase();
    const includeDone = !(includeDoneRaw === "false" || includeDoneRaw === "0" || includeDoneRaw === "no");
    if (!includeDone) {
      tasks = tasks.filter((task) => task.status !== "done");
    }

    if (options.assigneeMatrixId !== undefined && options.assigneeMatrixId !== null) {
      const assigneeMatrixId = parseActorMatrixId(options.assigneeMatrixId);
      if (!assigneeMatrixId) {
        throw new Error("assigneeMatrixId is invalid");
      }
      tasks = tasks.filter((task) => task.assigneeMatrixId === assigneeMatrixId);
    }

    if (options.creatorMatrixId !== undefined && options.creatorMatrixId !== null) {
      const creatorMatrixId = parseActorMatrixId(options.creatorMatrixId);
      if (!creatorMatrixId) {
        throw new Error("creatorMatrixId is invalid");
      }
      tasks = tasks.filter((task) => task.creatorMatrixId === creatorMatrixId);
    }

    const query = String(options.query ?? "").trim();
    if (query) {
      tasks = tasks.filter((task) => taskMatchesFullTextQuery(task, query));
    }

    const limit = parseTaskLimit(options.limit);
    const sliced = tasks.slice(0, limit);

    return {
      count: sliced.length,
      total: tasks.length,
      limit,
      tasks: sliced.map((task) => this.enrichTask(task, peopleByMatrixId)),
    };
  }

  async getTask(taskId: string): Promise<TaskView | null> {
    const snapshot = await this.stateStore.getSnapshot();
    const task = snapshot.tasks.find((entry) => entry.id === taskId) ?? null;
    if (!task) {
      return null;
    }

    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    return this.enrichTask(task, peopleByMatrixId);
  }

  async createTask(input: CreateTaskInput, actorMatrixId: string): Promise<TaskView & { assignmentNotification: { sent: boolean; error: string | null } }> {
    const task = await this.stateStore.createTask(input, actorMatrixId);
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    const enrichedTask = this.enrichTask(task, peopleByMatrixId);
    await this.stateStore.updateTaskContext(task.id, toTaskContextPatch(enrichedTask));

    let assignmentNotification: { sent: boolean; error: string | null } = { sent: false, error: null };
    if (enrichedTask.assigneeMatrixId) {
      const notification = await notifyAssigneeForTask(actorMatrixId, enrichedTask, enrichedTask.assigneeMatrixId, "created");
      assignmentNotification = {
        sent: notification.sent,
        error: notification.error,
      };
      if (notification.matrixRoomId || notification.matrixThreadRootEventId) {
        await this.stateStore.updateTaskContext(task.id, {
          matrixRoomId: notification.matrixRoomId,
          matrixThreadRootEventId: notification.matrixThreadRootEventId,
        });
      }
    }

    this.eventHub.emit("dashboard_update", { reason: "task_created", taskId: task.id });
    const latestTask = await this.getTask(task.id);
    if (!latestTask) {
      throw new Error("Task not found");
    }
    return {
      ...latestTask,
      assignmentNotification,
    };
  }

  async updateTask(
    taskId: string,
    input: UpdateTaskInput,
    actorMatrixId: string,
  ): Promise<TaskView & { assignmentNotification: { sent: boolean; error: string | null } }> {
    const previousTask = await this.getTask(taskId);
    const previousAssignee = previousTask?.assigneeMatrixId ?? null;

    const task = await this.stateStore.updateTask(taskId, input, actorMatrixId);
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    const enrichedTask = this.enrichTask(task, peopleByMatrixId);
    await this.stateStore.updateTaskContext(task.id, toTaskContextPatch(enrichedTask));

    let assignmentNotification: { sent: boolean; error: string | null } = { sent: false, error: null };
    if (enrichedTask.assigneeMatrixId && enrichedTask.assigneeMatrixId !== previousAssignee) {
      const notification = await notifyAssigneeForTask(actorMatrixId, enrichedTask, enrichedTask.assigneeMatrixId, "reassigned");
      assignmentNotification = {
        sent: notification.sent,
        error: notification.error,
      };
      if (notification.matrixRoomId || notification.matrixThreadRootEventId) {
        await this.stateStore.updateTaskContext(task.id, {
          matrixRoomId: notification.matrixRoomId,
          matrixThreadRootEventId: notification.matrixThreadRootEventId,
        });
      }
    }

    if (previousTask?.status !== "review" && enrichedTask.status === "review" && isWbrTask(enrichedTask)) {
      const vpMatrixId =
        enrichedTask.escalateToMatrixId
        ?? (enrichedTask.vp && enrichedTask.vp !== "Unknown" ? enrichedTask.vp : null);
      if (vpMatrixId) {
        await notifyVpForWbrReview(actorMatrixId, enrichedTask, vpMatrixId);
      }
    }

    this.eventHub.emit("dashboard_update", { reason: "task_updated", taskId: task.id });
    const latestTask = await this.getTask(task.id);
    if (!latestTask) {
      throw new Error("Task not found");
    }

    return {
      ...latestTask,
      assignmentNotification,
    };
  }

  async addComment(taskId: string, message: string, actorMatrixId: string): Promise<TaskView> {
    const task = await this.stateStore.addComment(taskId, message, actorMatrixId);
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    this.eventHub.emit("dashboard_update", { reason: "comment_added", taskId: task.id });
    return this.enrichTask(task, peopleByMatrixId);
  }

  async listTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return [...task.attachments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addTaskAttachmentUpload(
    taskId: string,
    input: {
      fileName: string;
      contentType?: string | null;
      data: Uint8Array;
    },
    actorMatrixId: string,
  ): Promise<TaskView> {
    const task = await this.stateStore.addAttachment(
      taskId,
      {
        kind: "upload",
        fileName: input.fileName,
        contentType: (input.contentType || "").trim() || contentTypeFromFileName(input.fileName),
        data: input.data,
      },
      actorMatrixId,
    );
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    this.eventHub.emit("dashboard_update", { reason: "attachment_added", taskId: task.id });
    return this.enrichTask(task, peopleByMatrixId);
  }

  async addTaskAttachmentLink(
    taskId: string,
    input: {
      sharedPath: string;
      fileName?: string;
      contentType?: string | null;
    },
    actorMatrixId: string,
  ): Promise<TaskView> {
    const task = await this.stateStore.addAttachment(
      taskId,
      {
        kind: "link",
        sharedPath: input.sharedPath,
        fileName: input.fileName,
        contentType: input.contentType ?? null,
      },
      actorMatrixId,
    );
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    this.eventHub.emit("dashboard_update", { reason: "attachment_added", taskId: task.id });
    return this.enrichTask(task, peopleByMatrixId);
  }

  async getTaskAttachmentContent(taskId: string, attachmentId: string): Promise<{
    task: TaskView;
    attachment: TaskAttachment;
    absolutePath: string;
    data: Buffer;
  }> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const attachment = task.attachments.find((entry) => entry.id === attachmentId);
    if (!attachment) {
      throw new Error("Attachment not found");
    }

    const absolutePath = resolve(SHARED_FILES_ROOT, normalizeSharedPath(attachment.sharedPath));
    const data = await fs.readFile(absolutePath).catch(() => null);
    if (!data) {
      throw new Error("Attachment file missing");
    }

    return {
      task,
      attachment,
      absolutePath,
      data,
    };
  }

  async queryPeople(action: PeopleAction, query: string, limit: number): Promise<string[]> {
    const directory = await this.orgDirectory.getSnapshot();
    return queryPeopleDirectory(directory, action, query, limit);
  }

  async seedWeeklyBusinessReviews(actorMatrixId: string, weekStartRaw?: string | null): Promise<WbrSeedResult> {
    const weekStart = normalizeWeekStart(weekStartRaw);
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    const directorTargets = this.getDirectorWbrTargets(orgData, peopleByMatrixId);
    const existingSnapshot = await this.stateStore.getSnapshot();
    const existingByAssignee = new Map<string, Task>();

    for (const task of existingSnapshot.tasks) {
      if (!isWbrTaskForWeek(task, weekStart)) {
        continue;
      }
      const assignee = task.assigneeMatrixId ?? task.ownerMatrixId;
      if (!assignee) {
        continue;
      }
      existingByAssignee.set(assignee, task);
    }

    let created = 0;
    let existing = 0;
    for (const target of directorTargets) {
      if (existingByAssignee.has(target.directorMatrixId)) {
        existing += 1;
        continue;
      }

      const title = `WBR ${weekStart} - ${target.department} - ${target.directorName}`;
      const deliverable = [
        "Weekly business review in Amazon style:",
        "1) Outcomes and KPI movement",
        "2) Risks, blockers, and escalation asks",
        "3) Next-week commitments and owners",
      ].join("\n");
      const createdTask = await this.createTask(
        {
          title,
          description:
            `Director weekly business review for ${target.department}. `
            + "Submit concise business update for VP review with metrics, risks, and decisions.",
          workItemType: "story",
          priority: "high",
          assigneeMatrixId: target.directorMatrixId,
          tags: [
            WBR_TAG,
            buildWbrWeekTag(weekStart),
            toDepartmentTag(target.department),
            "leadership",
            "weekly-review",
          ],
          deliverable,
          escalateToMatrixId: target.vpMatrixId,
        },
        actorMatrixId,
      );
      existingByAssignee.set(target.directorMatrixId, createdTask);
      created += 1;
    }

    const refreshedSnapshot = await this.stateStore.getSnapshot();
    const refreshedPeople = this.buildPeopleIndex(await this.orgDirectory.getSnapshot());
    const tasks = refreshedSnapshot.tasks
      .filter((task) => isWbrTaskForWeek(task, weekStart))
      .map((task) => this.enrichTask(task, refreshedPeople))
      .sort((a, b) => a.title.localeCompare(b.title));

    this.eventHub.emit("dashboard_update", { reason: "wbr_seeded", weekStart, created });
    return {
      weekStart,
      generatedAt: new Date().toISOString(),
      created,
      existing,
      totalTargets: directorTargets.length,
      tasks,
    };
  }

  async getWeeklyBusinessReviewSummary(weekStartRaw?: string | null): Promise<WbrWeeklySummary> {
    const weekStart = normalizeWeekStart(weekStartRaw);
    const [snapshot, orgData] = await Promise.all([this.stateStore.getSnapshot(), this.orgDirectory.getSnapshot()]);
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    const directorTargets = this.getDirectorWbrTargets(orgData, peopleByMatrixId);
    const departmentTargets = new Map<string, { vpMatrixId: string | null; directors: Set<string> }>();

    for (const target of directorTargets) {
      const current = departmentTargets.get(target.department) ?? { vpMatrixId: target.vpMatrixId, directors: new Set<string>() };
      current.directors.add(target.directorMatrixId);
      if (!current.vpMatrixId && target.vpMatrixId) {
        current.vpMatrixId = target.vpMatrixId;
      }
      departmentTargets.set(target.department, current);
    }

    const now = Date.now();
    const weekStartMs = Date.parse(`${weekStart}T00:00:00.000Z`);
    const weekDeadlineMs = Number.isFinite(weekStartMs) ? weekStartMs + 7 * 24 * 60 * 60 * 1000 : now;
    const submittedStatuses = new Set<TaskStatus>(["review", "done"]);

    const entriesByDepartment = new Map<string, WbrEntrySummary[]>();
    for (const task of snapshot.tasks) {
      if (!isWbrTaskForWeek(task, weekStart)) {
        continue;
      }
      const enriched = this.enrichTask(task, peopleByMatrixId);
      const department =
        enriched.department && enriched.department !== "Unknown"
          ? enriched.department
          : departmentFromTags(enriched) ?? "Unknown";
      const assigneeName =
        this.resolvePersonForMatrixId(enriched.assigneeMatrixId ?? enriched.ownerMatrixId ?? null, peopleByMatrixId)?.name
        ?? enriched.ownerName
        ?? enriched.assigneeMatrixId
        ?? "Unknown";
      const entry: WbrEntrySummary = {
        taskId: enriched.id,
        title: enriched.title,
        status: enriched.status,
        assigneeMatrixId: enriched.assigneeMatrixId,
        assigneeName,
        vpMatrixId: enriched.vp && enriched.vp !== "Unknown" ? enriched.vp : enriched.escalateToMatrixId ?? null,
        updatedAt: enriched.updatedAt,
      };

      const list = entriesByDepartment.get(department) ?? [];
      list.push(entry);
      entriesByDepartment.set(department, list);
    }

    const departmentNames = new Set<string>([
      ...Array.from(departmentTargets.keys()),
      ...Array.from(entriesByDepartment.keys()),
    ]);
    const departments: WbrDepartmentSummary[] = Array.from(departmentNames)
      .map((department) => {
        const target = departmentTargets.get(department) ?? { vpMatrixId: null, directors: new Set<string>() };
        const entries = (entriesByDepartment.get(department) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const submitted = entries.filter((entry) => submittedStatuses.has(entry.status)).length;
        const blocked = entries.filter((entry) => entry.status === "blocked").length;
        const pending = entries.length - submitted - blocked;
        const overdue = entries.filter((entry) => {
          if (submittedStatuses.has(entry.status)) {
            return false;
          }
          const updatedAt = Date.parse(entry.updatedAt);
          if (!Number.isFinite(updatedAt)) {
            return now > weekDeadlineMs;
          }
          return now > weekDeadlineMs && updatedAt < weekDeadlineMs;
        }).length;
        const latestUpdatedAt = entries[0]?.updatedAt ?? null;

        return {
          department,
          vpMatrixId: target.vpMatrixId,
          expectedDirectors: target.directors.size,
          totalEntries: entries.length,
          submitted,
          pending,
          blocked,
          overdue,
          latestUpdatedAt,
          entries,
        };
      })
      .sort((a, b) => a.department.localeCompare(b.department));

    const totals = departments.reduce(
      (acc, department) => {
        acc.expectedDirectors += department.expectedDirectors;
        acc.totalEntries += department.totalEntries;
        acc.submitted += department.submitted;
        acc.pending += department.pending;
        acc.blocked += department.blocked;
        acc.overdue += department.overdue;
        return acc;
      },
      {
        departments: departments.length,
        expectedDirectors: 0,
        totalEntries: 0,
        submitted: 0,
        pending: 0,
        blocked: 0,
        overdue: 0,
      },
    );

    return {
      weekStart,
      generatedAt: new Date().toISOString(),
      totals,
      departments,
    };
  }

  async getDashboard(currentUser?: string): Promise<{
    currentUser: string;
    agents: AgentSummary[];
    tasks: TaskView[];
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
    const snapshot = await this.stateStore.getSnapshot();
    const orgData = await this.orgDirectory.getSnapshot();
    const peopleByMatrixId = this.buildPeopleIndex(orgData);
    const agents = await this.loadAgents(snapshot.tasks);
    const tasks = snapshot.tasks.map((task) => this.enrichTask(task, peopleByMatrixId));

    const fallbackUser = this.resolveDefaultCurrentUser(orgData, snapshot.tasks);

    return {
      currentUser: currentUser?.trim() || fallbackUser,
      agents,
      tasks,
      activity: snapshot.activity,
      totals: {
        totalTasks: tasks.length,
        inProgress: tasks.filter((task) => task.status === "in_progress").length,
        review: tasks.filter((task) => task.status === "review").length,
        completed: tasks.filter((task) => task.status === "done").length,
        activeAgents: agents.filter((agent) => agent.status === "working" || agent.status === "idle").length,
      },
      statuses: TASK_STATUSES,
      priorities: TASK_PRIORITIES,
    };
  }

  private getDirectorWbrTargets(
    orgData: OrgData,
    peopleByMatrixId: Map<string, OrgPerson>,
  ): Array<{
    directorMatrixId: string;
    directorName: string;
    department: string;
    vpMatrixId: string | null;
  }> {
    const departmentVpByName = new Map<string, string>();
    for (const department of orgData.departments) {
      if (!department.vp) {
        continue;
      }
      const normalized = normalizeNullableMatrixId(department.vp);
      if (!normalized) {
        continue;
      }
      departmentVpByName.set(department.name, normalized);
    }

    return orgData.people
      .filter((person) => person.level.toLowerCase().includes("director"))
      .map((person) => {
        const directorMatrixId = normalizeMatrixId(person.matrixId);
        let vpMatrixId: string | null = null;

        const visited = new Set<string>();
        let cursor: OrgPerson | null = person;
        while (cursor && !visited.has(cursor.matrixId)) {
          visited.add(cursor.matrixId);
          if (cursor.level.toLowerCase().includes("vp")) {
            vpMatrixId = normalizeMatrixId(cursor.matrixId);
            break;
          }
          cursor = cursor.reportsTo ? peopleByMatrixId.get(normalizeMatrixId(cursor.reportsTo)) ?? null : null;
        }

        if (!vpMatrixId) {
          vpMatrixId = departmentVpByName.get(person.department) ?? null;
        }

        return {
          directorMatrixId,
          directorName: person.name,
          department: person.department || "Unknown",
          vpMatrixId,
        };
      });
  }

  private resolveDefaultCurrentUser(orgData: OrgData, tasks: Task[]): string {
    const configuredBot = TASK_ASSIGNMENT_BOT_MATRIX_ID.trim();
    const ceo = orgData.people.find((person) => person.level.toLowerCase() === "ceo");
    return ceo?.matrixId || configuredBot || tasks[0]?.creatorMatrixId || "@unknown:anycompany.corp";
  }

  private buildPeopleIndex(orgData: OrgData): Map<string, OrgPerson> {
    return new Map(orgData.people.map((person) => [normalizeMatrixId(person.matrixId), person]));
  }

  private resolvePersonForMatrixId(matrixId: string | null, peopleByMatrixId: Map<string, OrgPerson>): OrgPerson | null {
    if (!matrixId) {
      return null;
    }

    const direct = peopleByMatrixId.get(matrixId);
    if (direct) {
      return direct;
    }

    const localPart = matrixLocalPart(matrixId);
    if (!localPart) {
      return null;
    }

    const candidates = Array.from(peopleByMatrixId.values()).filter((person) => {
      const personLocalPart = matrixLocalPart(person.matrixId);
      return personLocalPart === localPart || personLocalPart.startsWith(localPart) || localPart.startsWith(personLocalPart);
    });

    return candidates.length === 1 ? candidates[0] : null;
  }

  private enrichTask(task: Task, peopleByMatrixId: Map<string, OrgPerson>): TaskView {
    const rawOwnerMatrixId = task.assigneeMatrixId ?? task.ownerMatrixId ?? task.creatorMatrixId ?? null;
    let ownerMatrixId: string | null = rawOwnerMatrixId;
    if (rawOwnerMatrixId) {
      try {
        ownerMatrixId = normalizeMatrixId(rawOwnerMatrixId);
      } catch {
        ownerMatrixId = rawOwnerMatrixId;
      }
    }
    const owner =
      this.resolvePersonForMatrixId(ownerMatrixId, peopleByMatrixId)
      ?? this.resolvePersonForMatrixId(task.creatorMatrixId, peopleByMatrixId);

    let vp = task.vp || "Unknown";
    let director = task.director || "Unknown";
    let manager = task.manager || "Unknown";

    if (owner) {
      const visited = new Set<string>();
      let cursor: OrgPerson | undefined = owner;
      while (cursor && !visited.has(cursor.matrixId)) {
        visited.add(cursor.matrixId);
        const level = cursor.level.toLowerCase();
        if (vp === "Unknown" && level.includes("vp")) {
          vp = cursor.matrixId;
        }
        if (director === "Unknown" && level.includes("director")) {
          director = cursor.matrixId;
        }
        if (manager === "Unknown" && level.includes("manager")) {
          manager = cursor.matrixId;
        }
        cursor = cursor.reportsTo ? peopleByMatrixId.get(normalizeMatrixId(cursor.reportsTo)) : undefined;
      }
    }

    const department = owner?.department || task.department || "Unknown";
    const team = owner?.team || task.team || "Unknown";
    const departments = task.departments.length > 0
      ? Array.from(new Set(task.departments))
      : department !== "Unknown"
      ? [department]
      : [];

    return {
      ...task,
      ownerMatrixId: ownerMatrixId ?? task.ownerMatrixId ?? null,
      ownerName: owner?.name ?? task.ownerName ?? ownerMatrixId ?? "Unknown",
      department,
      departments,
      team,
      vp,
      director,
      manager,
    };
  }

  createSseResponse(signal: AbortSignal): Response {
    const encoder = new TextEncoder();
    const clientId = `client_${randomUUID()}`;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const client: SseClient = {
          id: clientId,
          send: (eventName: string, payload: unknown) => {
            controller.enqueue(encoder.encode(`event: ${eventName}\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          },
          close: () => {
            try {
              controller.close();
            } catch {
              // stream may already be closed
            }
          },
        };

        this.eventHub.addClient(client);

        const cleanup = () => {
          this.eventHub.removeClient(clientId);
        };

        signal.addEventListener("abort", cleanup, { once: true });
      },
      cancel: () => {
        this.eventHub.removeClient(clientId);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  parseTaskStatus(value: unknown): TaskStatus | null {
    return parseTaskStatus(value);
  }

  parseTaskPriority(value: unknown): TaskPriority | null {
    return parseTaskPriority(value);
  }

  parseTaskWorkItemType(value: unknown): TaskWorkItemType | null {
    return parseTaskWorkItemType(value);
  }

  parseTaskTags(value: unknown): string[] {
    if (Array.isArray(value)) {
      return sanitizeTags(value.map((entry) => String(entry)));
    }
    if (typeof value === "string") {
      return sanitizeTags(value.split(",").map((entry) => entry.trim()));
    }
    return [];
  }

  parseOptionalText(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return sanitizeOptionalText(String(value));
  }

  parseNullableMatrixId(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string") {
      return null;
    }
    try {
      return normalizeNullableMatrixId(value);
    } catch {
      return null;
    }
  }

  parseActorMatrixId(value: unknown): string | null {
    return parseActorMatrixId(value);
  }

  parsePeopleAction(value: unknown): PeopleAction | null {
    return parsePeopleAction(value);
  }

  parsePeopleLimit(value: unknown): number {
    return parsePeopleLimit(value);
  }

  sanitizeRequiredText(value: string, label: string): string {
    return sanitizeRequiredText(value, label);
  }

  private async loadAgents(tasks: Task[]): Promise<AgentSummary[]> {
    const statusMap = buildAgentStatusMap(tasks);
    const deployedMatrixIds = await listDeployedAgentMatrixIds();
    const seen = new Set<string>();
    const agents: AgentSummary[] = [];
    const orgData = await this.orgDirectory.getSnapshot();
    const knownMatrixIds = new Set(orgData.people.map((person) => normalizeMatrixId(person.matrixId)));

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
        title: person.title ?? "Agent",
        department: person.department ?? "Unassigned",
        team: person.team ?? "General",
        status: statusMap.get(matrixId) ?? (deployed ? "idle" : "external"),
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
          title: "Agent",
          department: "Unassigned",
          team: "General",
          status: statusMap.get(matrixId) ?? "idle",
        });
      }
    }

    for (const task of tasks) {
      for (const matrixId of [task.creatorMatrixId, task.assigneeMatrixId]) {
        if (!matrixId || seen.has(matrixId)) {
          continue;
        }

        if (!knownMatrixIds.has(matrixId) && !deployedMatrixIds.has(matrixId)) {
          continue;
        }

        seen.add(matrixId);
        const deployed = deployedMatrixIds.size === 0 || deployedMatrixIds.has(matrixId);
        agents.push({
          matrixId,
          name: matrixId,
          title: "Agent",
          department: "Unassigned",
          team: "General",
          status: statusMap.get(matrixId) ?? (deployed ? "idle" : "external"),
        });
      }
    }

    agents.sort((a, b) => a.name.localeCompare(b.name));
    return agents;
  }

  private startKeepalive(): void {
    if (this.keepaliveStarted) {
      return;
    }

    this.keepaliveStarted = true;
    const timer = setInterval(() => {
      this.eventHub.emit("keepalive", { ts: new Date().toISOString() });
    }, 30_000);

    timer.unref?.();
  }
}

type GlobalState = typeof globalThis & {
  __openClawCommandCenterBackend?: CommandCenterBackend;
};

const globalState = globalThis as GlobalState;
if (!globalState.__openClawCommandCenterBackend) {
  globalState.__openClawCommandCenterBackend = new CommandCenterBackend();
}

export const commandCenterBackend = globalState.__openClawCommandCenterBackend;

export function isServiceAuthAuthorized(headers: Headers): boolean {
  return commandCenterBackend.isServiceAuthorized(headers);
}

export function serviceAuthErrorBody(): { error: string } {
  return { error: "Unauthorized" };
}
