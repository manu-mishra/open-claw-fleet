import { Type } from "@sinclair/typebox";
import { createHmac, randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";

type TaskAction = "list" | "get" | "create" | "update" | "comment" | "escalate" | "attachments" | "attach" | "matrix_file";
type TaskStatus = "inbox" | "assigned" | "in_progress" | "review" | "done" | "blocked";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type TaskWorkItemType = "epic" | "feature" | "story" | "task";

interface TaskRecord {
  id: string;
  title: string;
  description: string;
  workItemType: TaskWorkItemType;
  parentTaskId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  creatorMatrixId: string;
  assigneeMatrixId: string | null;
  ownerMatrixId?: string | null;
  ownerName?: string;
  department?: string;
  team?: string;
  vp?: string;
  director?: string;
  manager?: string;
  tags: string[];
  deliverable: string;
  blockedReason?: string | null;
  blockerOwnerMatrixId?: string | null;
  escalateToMatrixId?: string | null;
  nextAction?: string | null;
  matrixRoomId?: string | null;
  matrixThreadRootEventId?: string | null;
  createdAt: string;
  updatedAt: string;
  comments: Array<{
    id: string;
    authorMatrixId: string;
    message: string;
    createdAt: string;
  }>;
  attachments?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sharedPath: string;
    sourceKind: "upload" | "link";
    createdAt: string;
    createdByMatrixId: string;
  }>;
}

interface CommandCenterListResponse {
  count: number;
  total: number;
  limit: number;
  tasks: TaskRecord[];
}

interface AttachmentListResponse {
  taskId: string;
  count: number;
  attachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sharedPath: string;
    sourceKind: "upload" | "link";
    createdAt: string;
    createdByMatrixId: string;
  }>;
}

const COMMAND_CENTER_URL = (process.env.COMMAND_CENTER_URL || "http://command-center:8090").replace(/\/+$/, "");
const COMMAND_CENTER_API_TOKEN = process.env.COMMAND_CENTER_API_TOKEN || "";
const COMMAND_CENTER_TIMEOUT_MS = Number.parseInt(process.env.COMMAND_CENTER_TIMEOUT_MS || "10000", 10);
const MATRIX_DOMAIN = process.env.MATRIX_DOMAIN || "anycompany.corp";
const MATRIX_HOMESERVER = (process.env.MATRIX_HOMESERVER || "http://conduit:6167").replace(/\/+$/, "");
const AGENT_MATRIX_ID = process.env.AGENT_MATRIX_ID || "";
const FLEET_SECRET = process.env.FLEET_SECRET || "";
const DEFAULT_ACTOR_MATRIX_ID = process.env.AGENT_MATRIX_ID || "";
const TASK_STATUSES: TaskStatus[] = ["inbox", "assigned", "in_progress", "review", "done", "blocked"];
const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const TASK_WORK_ITEM_TYPES: TaskWorkItemType[] = ["epic", "feature", "story", "task"];
const DEFAULT_COMMENT_LIMIT = 20;
const MAX_COMMENT_LIMIT = 200;
const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  inbox: ["assigned", "in_progress", "blocked"],
  assigned: ["in_progress", "review", "blocked"],
  in_progress: ["review", "blocked", "assigned"],
  review: ["done", "in_progress", "blocked"],
  blocked: ["assigned", "in_progress", "review", "done"],
  done: ["review", "in_progress"],
};

function normalizeMatrixId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("matrixId cannot be empty");
  }

  if (trimmed.startsWith("@") && trimmed.includes(":")) {
    return trimmed;
  }
  if (trimmed.startsWith("@")) {
    return `${trimmed}:${MATRIX_DOMAIN}`;
  }
  if (trimmed.includes(":")) {
    return `@${trimmed}`;
  }
  return `@${trimmed}:${MATRIX_DOMAIN}`;
}

function resolveActorMatrixId(rawActor?: string): string {
  const candidate = rawActor?.trim() || DEFAULT_ACTOR_MATRIX_ID.trim();
  if (!candidate) {
    throw new Error("actorMatrixId is required and AGENT_MATRIX_ID is not set");
  }
  return normalizeMatrixId(candidate);
}

function parseJson(payload: string): unknown {
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function parseStatus(value: unknown): TaskStatus | null {
  const candidate = String(value ?? "").trim();
  return TASK_STATUSES.includes(candidate as TaskStatus) ? (candidate as TaskStatus) : null;
}

function parsePriority(value: unknown): TaskPriority | null {
  const candidate = String(value ?? "").trim();
  return TASK_PRIORITIES.includes(candidate as TaskPriority) ? (candidate as TaskPriority) : null;
}

function parseWorkItemType(value: unknown): TaskWorkItemType | null {
  const candidate = String(value ?? "").trim().toLowerCase();
  return TASK_WORK_ITEM_TYPES.includes(candidate as TaskWorkItemType) ? (candidate as TaskWorkItemType) : null;
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateStatusTransition(current: TaskStatus, next: TaskStatus): void {
  if (current === next) {
    return;
  }

  const allowed = ALLOWED_STATUS_TRANSITIONS[current] ?? [];
  if (allowed.includes(next)) {
    return;
  }

  throw new Error(
    `Invalid stage transition: ${current} -> ${next}. Allowed: ${allowed.length ? allowed.join(", ") : "(none)"}`,
  );
}

function parseCommentLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_COMMENT_LIMIT;
  }
  const rounded = Math.floor(value);
  return Math.max(1, Math.min(MAX_COMMENT_LIMIT, rounded));
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  return rounded >= 0 ? rounded : null;
}

function formatTaskSummary(task: TaskRecord): string {
  const blocked = task.blockedReason ? ` | blockedReason=${task.blockedReason}` : "";
  return `${task.id} | ${task.workItemType} | ${task.status} | ${task.priority} | ${task.title} | assignee=${task.assigneeMatrixId ?? "none"} | parent=${task.parentTaskId ?? "none"}${blocked}`;
}

function buildEscalationMessage(input: {
  actorMatrixId: string;
  reason: string;
  nextAction: string;
  impact?: string;
  blockerOwnerMatrixId?: string | null;
  escalateToMatrixId?: string | null;
}): string {
  const lines = [
    "[ESCALATION]",
    `Reason: ${input.reason}`,
    input.impact ? `Impact: ${input.impact}` : null,
    input.blockerOwnerMatrixId ? `Blocker owner: ${input.blockerOwnerMatrixId}` : null,
    input.escalateToMatrixId ? `Escalate to: ${input.escalateToMatrixId}` : null,
    `Next action: ${input.nextAction}`,
    `Requested by: ${input.actorMatrixId}`,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function contentTypeFromFileName(fileName: string, fallback = "application/octet-stream"): string {
  switch (extname(fileName.toLowerCase())) {
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
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

function normalizeLinkPathForTask(linkPath: string): string {
  const trimmed = linkPath.trim();
  if (!trimmed) {
    throw new Error("linkPath cannot be empty");
  }

  const normalizedSlashes = trimmed.replace(/\\/g, "/");
  if (normalizedSlashes.startsWith("/shared/")) {
    const relative = normalizedSlashes.slice("/shared/".length);
    if (!relative.trim()) {
      throw new Error("linkPath must include a file under /shared");
    }
    return relative;
  }
  if (normalizedSlashes === "/shared") {
    throw new Error("linkPath must include a file under /shared");
  }

  return normalizedSlashes.replace(/^\/+/, "");
}

async function commandCenterRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(COMMAND_CENTER_TIMEOUT_MS) ? COMMAND_CENTER_TIMEOUT_MS : 10000,
  );

  try {
    const response = await fetch(`${COMMAND_CENTER_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(COMMAND_CENTER_API_TOKEN ? { "x-command-center-token": COMMAND_CENTER_API_TOKEN } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      const detail =
        typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : text || response.statusText;
      throw new Error(`Command Center request failed (${response.status}): ${detail}`);
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function commandCenterFormRequest<T>(path: string, method: "POST", formData: FormData): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(COMMAND_CENTER_TIMEOUT_MS) ? COMMAND_CENTER_TIMEOUT_MS : 10000,
  );

  try {
    const response = await fetch(`${COMMAND_CENTER_URL}${path}`, {
      method,
      headers: {
        ...(COMMAND_CENTER_API_TOKEN ? { "x-command-center-token": COMMAND_CENTER_API_TOKEN } : {}),
      },
      body: formData,
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      const detail =
        typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : text || response.statusText;
      throw new Error(`Command Center request failed (${response.status}): ${detail}`);
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

function parseContentDispositionFileName(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

async function commandCenterBinaryRequest(path: string): Promise<{
  bytes: Uint8Array<ArrayBufferLike>;
  contentType: string;
  fileName: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(COMMAND_CENTER_TIMEOUT_MS) ? COMMAND_CENTER_TIMEOUT_MS : 10000,
  );

  try {
    const response = await fetch(`${COMMAND_CENTER_URL}${path}`, {
      method: "GET",
      headers: {
        ...(COMMAND_CENTER_API_TOKEN ? { "x-command-center-token": COMMAND_CENTER_API_TOKEN } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Command Center binary request failed (${response.status}): ${text || response.statusText}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      fileName: parseContentDispositionFileName(response.headers.get("content-disposition")),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function deriveMatrixPassword(matrixId: string, secret: string): string {
  return createHmac("sha256", secret).update(matrixId).digest("hex").slice(0, 32);
}

async function matrixJsonRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  token?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${MATRIX_HOMESERVER}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw new Error(`Matrix request failed (${response.status}): ${text || response.statusText}`);
  }
  return payload as T;
}

async function ensureMatrixToken(): Promise<string> {
  if (!AGENT_MATRIX_ID.trim()) {
    throw new Error("AGENT_MATRIX_ID is required for matrix_file action");
  }
  if (!FLEET_SECRET.trim()) {
    throw new Error("FLEET_SECRET is required for matrix_file action");
  }

  const username = AGENT_MATRIX_ID.split(":")[0].replace(/^@/, "");
  const password = deriveMatrixPassword(AGENT_MATRIX_ID, FLEET_SECRET);
  const loginPayload = {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: username },
    password,
  };

  try {
    const response = await matrixJsonRequest<{ access_token: string }>("/_matrix/client/r0/login", "POST", undefined, loginPayload);
    return response.access_token;
  } catch {
    try {
      await matrixJsonRequest("/_matrix/client/r0/register", "POST", undefined, {
        username,
        password,
        auth: { type: "m.login.dummy" },
      });
    } catch {
      // ignore if already exists
    }
    const response = await matrixJsonRequest<{ access_token: string }>("/_matrix/client/r0/login", "POST", undefined, loginPayload);
    return response.access_token;
  }
}

function matrixMsgType(contentType: string): "m.file" | "m.image" | "m.video" | "m.audio" {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("image/")) return "m.image";
  if (normalized.startsWith("video/")) return "m.video";
  if (normalized.startsWith("audio/")) return "m.audio";
  return "m.file";
}

async function uploadToMatrix(
  token: string,
  fileName: string,
  contentType: string,
  bytes: Uint8Array<ArrayBufferLike>,
): Promise<string> {
  const query = `?filename=${encodeURIComponent(fileName)}`;
  const endpoints = ["/_matrix/media/v3/upload", "/_matrix/media/r0/upload"];
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${MATRIX_HOMESERVER}${endpoint}${query}`, {
        method: "POST",
        headers: {
          "Content-Type": contentType || "application/octet-stream",
          Authorization: `Bearer ${token}`,
        },
        body: Buffer.from(bytes),
      });
      const payload = parseJson(await response.text());
      if (!response.ok) {
        throw new Error(`upload failed (${response.status})`);
      }
      const contentUri = typeof payload === "object" && payload !== null ? (payload as { content_uri?: unknown }).content_uri : null;
      if (typeof contentUri !== "string" || !contentUri.startsWith("mxc://")) {
        throw new Error("matrix upload did not return content_uri");
      }
      return contentUri;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown matrix upload error");
    }
  }

  throw lastError ?? new Error("Matrix upload failed");
}

async function sendMatrixFileMessage(input: {
  roomId: string;
  threadRootEventId?: string | null;
  message?: string | null;
  fileName: string;
  contentType: string;
  bytes: Uint8Array<ArrayBufferLike>;
}): Promise<{ mxcUri: string; eventId: string }> {
  const token = await ensureMatrixToken();
  const mxcUri = await uploadToMatrix(token, input.fileName, input.contentType, input.bytes);
  const eventId = randomUUID();
  const payload: Record<string, unknown> = {
    msgtype: matrixMsgType(input.contentType),
    body: (input.message || "").trim() || input.fileName,
    filename: input.fileName,
    url: mxcUri,
    info: {
      mimetype: input.contentType || "application/octet-stream",
      size: input.bytes.byteLength,
    },
  };

  const threadRootEventId = (input.threadRootEventId || "").trim();
  if (threadRootEventId) {
    payload["m.relates_to"] = {
      rel_type: "m.thread",
      event_id: threadRootEventId,
      is_falling_back: true,
      "m.in_reply_to": {
        event_id: threadRootEventId,
      },
    };
  }

  const response = await matrixJsonRequest<{ event_id: string }>(
    `/_matrix/client/r0/rooms/${encodeURIComponent(input.roomId)}/send/m.room.message/${encodeURIComponent(eventId)}`,
    "PUT",
    token,
    payload,
  );

  return {
    mxcUri,
    eventId: response.event_id,
  };
}

export function createTasksTool() {
  return {
    name: "tasks",
    description:
      "Manage Command Center work items (epic, feature, story, task) across stages (inbox, assigned, in_progress, review, done, blocked), plus file operations. You can upload local files to tasks (filePath), link shared files (linkPath), list attachments, and send files to Matrix. Actions: list, get, create, update, comment, escalate, attachments, attach, matrix_file.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("list"),
          Type.Literal("get"),
          Type.Literal("create"),
          Type.Literal("update"),
          Type.Literal("comment"),
          Type.Literal("escalate"),
          Type.Literal("attachments"),
          Type.Literal("attach"),
          Type.Literal("matrix_file"),
        ],
        { description: "Task action: list, get, create, update, comment, escalate, attachments, attach, matrix_file" },
      ),
      taskId: Type.Optional(Type.String({ description: "Task ID for get/update/comment/escalate/attachments/attach/matrix_file" })),
      title: Type.Optional(Type.String({ description: "Task title for create/update" })),
      description: Type.Optional(Type.String({ description: "Task description for create/update" })),
      workItemType: Type.Optional(
        Type.Union([
          Type.Literal("epic"),
          Type.Literal("feature"),
          Type.Literal("story"),
          Type.Literal("task"),
        ]),
      ),
      status: Type.Optional(
        Type.Union([
          Type.Literal("inbox"),
          Type.Literal("assigned"),
          Type.Literal("in_progress"),
          Type.Literal("review"),
          Type.Literal("done"),
          Type.Literal("blocked"),
        ]),
      ),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
          Type.Literal("urgent"),
        ]),
      ),
      parentTaskId: Type.Optional(Type.String({ description: "Parent task ID; use 'none' to target root work items in list" })),
      assigneeMatrixId: Type.Optional(Type.String({ description: "Assignee matrix ID" })),
      creatorMatrixId: Type.Optional(Type.String({ description: "Filter by creator matrix ID (list)" })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Task tags" })),
      deliverable: Type.Optional(Type.String({ description: "Required on create; optional on update" })),
      message: Type.Optional(Type.String({ description: "Comment body for comment action" })),
      blockedReason: Type.Optional(Type.String({ description: "Blocking reason (required when setting status=blocked)" })),
      nextAction: Type.Optional(Type.String({ description: "Specific next action to unblock task (required when status=blocked)" })),
      blockerOwnerMatrixId: Type.Optional(Type.String({ description: "Matrix ID of dependency owner causing block" })),
      escalateToMatrixId: Type.Optional(Type.String({ description: "Matrix ID for escalation owner (VP/Director/Manager)" })),
      includeComments: Type.Optional(Type.Boolean({ description: "Get action: include full comment thread output (default true)" })),
      commentLimit: Type.Optional(Type.Number({ description: "Get action: max comments to include (default 20, max 200)" })),
      commentStart: Type.Optional(Type.Number({ description: "Get action: 0-based comment start index (chronological). If omitted, returns latest N comments." })),
      includeHierarchy: Type.Optional(Type.Boolean({ description: "Get action: include parent/child detection output (default true)" })),
      reason: Type.Optional(Type.String({ description: "Escalation reason for escalate action" })),
      impact: Type.Optional(Type.String({ description: "Business or delivery impact for escalate action" })),
      setBlocked: Type.Optional(Type.Boolean({ description: "Escalate action: set task stage to blocked (default true)" })),
      query: Type.Optional(Type.String({ description: "Full-text search across task id/title/description/definition-of-done/comments/tags" })),
      limit: Type.Optional(Type.Number({ description: "Max list results (default 20, max 200)" })),
      includeDone: Type.Optional(Type.Boolean({ description: "Include done tasks in list (default true)" })),
      mine: Type.Optional(Type.Boolean({ description: "Shortcut for list: assignee=actor" })),
      filePath: Type.Optional(Type.String({ description: "Local file path to upload/send. For attach: uploads file into task attachments." })),
      fileName: Type.Optional(Type.String({ description: "Optional file name override for attach/matrix_file" })),
      contentType: Type.Optional(Type.String({ description: "Optional MIME type override for attach/matrix_file" })),
      linkPath: Type.Optional(Type.String({ description: "Shared storage path for attach link mode (relative or /shared/...). Use for cross-agent shared files." })),
      attachmentId: Type.Optional(Type.String({ description: "Existing task attachment ID (matrix_file action)" })),
      roomId: Type.Optional(Type.String({ description: "Target Matrix room ID (matrix_file action). If omitted and taskId is set, uses task room." })),
      threadRootEventId: Type.Optional(Type.String({ description: "Optional Matrix thread root event ID (matrix_file/attach sendToMatrix)." })),
      matrixMessage: Type.Optional(Type.String({ description: "Message body for matrix_file or attach sendToMatrix" })),
      sendToMatrix: Type.Optional(Type.Boolean({ description: "Attach action: also send uploaded/linked file to task Matrix thread" })),
      actorMatrixId: Type.Optional(Type.String({ description: "Actor matrix ID; defaults to AGENT_MATRIX_ID" })),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const action = params.action as TaskAction;
      const actorMatrixId =
        typeof params.actorMatrixId === "string" ? resolveActorMatrixId(params.actorMatrixId) : resolveActorMatrixId();

      if (action === "list") {
        const query = new URLSearchParams();
        if (typeof params.status === "string") {
          query.set("status", params.status);
        }
        if (typeof params.workItemType === "string") {
          query.set("workItemType", params.workItemType);
        }
        if (typeof params.parentTaskId === "string") {
          query.set("parentTaskId", params.parentTaskId.trim() || "none");
        }
        if (typeof params.limit === "number") {
          query.set("limit", String(params.limit));
        }
        if (typeof params.query === "string" && params.query.trim()) {
          query.set("query", params.query.trim());
        }
        if (typeof params.includeDone === "boolean") {
          query.set("includeDone", params.includeDone ? "true" : "false");
        }

        if (params.mine === true) {
          query.set("assigneeMatrixId", actorMatrixId);
        } else if (typeof params.assigneeMatrixId === "string" && params.assigneeMatrixId.trim()) {
          query.set("assigneeMatrixId", normalizeMatrixId(params.assigneeMatrixId));
        }

        if (typeof params.creatorMatrixId === "string" && params.creatorMatrixId.trim()) {
          query.set("creatorMatrixId", normalizeMatrixId(params.creatorMatrixId));
        }

        const payload = await commandCenterRequest<CommandCenterListResponse>(
          `/api/agent/tasks?${query.toString()}`,
          "GET",
        );

        const lines = payload.tasks.map((task) => formatTaskSummary(task));
        return {
          content: [
            {
              type: "text",
              text: lines.length > 0 ? lines.join("\n") : "No tasks found",
            },
          ],
        };
      }

      if (action === "get") {
        const taskId = String(params.taskId ?? "").trim();
        if (!taskId) {
          throw new Error("taskId is required for get");
        }

        const task = await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, "GET");
        const includeComments = params.includeComments !== false;
        const commentLimit = parseCommentLimit(params.commentLimit);
        const commentStart = parseNonNegativeInt(params.commentStart);
        const orderedComments = [...task.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const commentTotal = orderedComments.length;
        const commentRangeStart = commentStart !== null ? Math.min(commentStart, commentTotal) : Math.max(0, commentTotal - commentLimit);
        const commentRangeEnd = Math.min(commentTotal, commentRangeStart + commentLimit);
        const commentsToShow = includeComments ? orderedComments.slice(commentRangeStart, commentRangeEnd) : [];
        const commentLines = commentsToShow.length
          ? commentsToShow.flatMap((comment, index) => {
              const ordinal = String(commentRangeStart + index + 1).padStart(2, "0");
              return [
                `${ordinal}. ${comment.createdAt} | ${comment.authorMatrixId}`,
                `${comment.message}`,
                "",
              ];
            })
          : ["(no comments)"];

        const includeHierarchy = params.includeHierarchy !== false;
        let parentLine = "parent: none";
        const childListResponse = includeHierarchy
          ? await commandCenterRequest<CommandCenterListResponse>(
              `/api/agent/tasks?parentTaskId=${encodeURIComponent(task.id)}&includeDone=true&limit=200`,
              "GET",
            )
          : null;

        if (includeHierarchy && task.parentTaskId) {
          try {
            const parentTask = await commandCenterRequest<TaskRecord>(
              `/api/agent/tasks/${encodeURIComponent(task.parentTaskId)}`,
              "GET",
            );
            parentLine = `parent: ${parentTask.id} | ${parentTask.workItemType} | ${parentTask.status} | ${parentTask.title}`;
          } catch {
            parentLine = `parent: ${task.parentTaskId} (not found)`;
          }
        }

        const childLines = includeHierarchy
          ? (childListResponse?.tasks ?? []).slice(0, 25).map((child) => `- ${formatTaskSummary(child)}`)
          : [];
        const childSummaryLine = includeHierarchy
          ? `children: ${childListResponse?.total ?? childLines.length}`
          : "children: (omitted)";

        return {
          content: [
            {
              type: "text",
              text: [
                formatTaskSummary(task),
                `deliverable: ${task.deliverable}`,
                `description: ${task.description || "(empty)"}`,
                `blockedReason: ${task.blockedReason ?? "(none)"}`,
                `nextAction: ${task.nextAction ?? "(none)"}`,
                `blockerOwner: ${task.blockerOwnerMatrixId ?? "(none)"}`,
                `escalateTo: ${task.escalateToMatrixId ?? "(none)"}`,
                `matrixThread: room=${task.matrixRoomId ?? "(none)"} root=${task.matrixThreadRootEventId ?? "(none)"}`,
                parentLine,
                childSummaryLine,
                ...(includeHierarchy && childLines.length > 0 ? ["child tasks:", ...childLines] : []),
                `comments: ${commentTotal}`,
                includeComments
                  ? `comment thread (${commentTotal === 0 ? "0-0" : `${commentRangeStart + 1}-${commentRangeEnd}`} of ${commentTotal}, chronological):`
                  : "comment thread: (omitted)",
                ...(includeComments ? commentLines : []),
              ].join("\n"),
            },
          ],
        };
      }

      if (action === "create") {
        const title = String(params.title ?? "").trim();
        const deliverable = String(params.deliverable ?? "").trim();
        if (!title) {
          throw new Error("title is required for create");
        }
        if (!deliverable) {
          throw new Error("deliverable is required for create");
        }

        const workItemType = parseWorkItemType(params.workItemType) ?? "task";
        const priority = parsePriority(params.priority) ?? "medium";
        const payload = {
          actorMatrixId,
          title,
          description: typeof params.description === "string" ? params.description : "",
          workItemType,
          priority,
          assigneeMatrixId:
            typeof params.assigneeMatrixId === "string" && params.assigneeMatrixId.trim()
              ? normalizeMatrixId(params.assigneeMatrixId)
              : null,
          blockedReason: typeof params.blockedReason === "string" ? params.blockedReason.trim() : null,
          nextAction: typeof params.nextAction === "string" ? params.nextAction.trim() : null,
          blockerOwnerMatrixId:
            typeof params.blockerOwnerMatrixId === "string" && params.blockerOwnerMatrixId.trim()
              ? normalizeMatrixId(params.blockerOwnerMatrixId)
              : null,
          escalateToMatrixId:
            typeof params.escalateToMatrixId === "string" && params.escalateToMatrixId.trim()
              ? normalizeMatrixId(params.escalateToMatrixId)
              : null,
          tags: Array.isArray(params.tags) ? params.tags.map((entry) => String(entry)) : [],
          deliverable,
          ...(Object.prototype.hasOwnProperty.call(params, "parentTaskId")
            ? {
                parentTaskId:
                  typeof params.parentTaskId === "string" && params.parentTaskId.trim()
                    ? params.parentTaskId.trim()
                    : null,
              }
            : {}),
        } as Record<string, unknown>;

        const task = await commandCenterRequest<TaskRecord>("/api/agent/tasks", "POST", payload);
        return {
          content: [
            {
              type: "text",
              text: `Created task: ${formatTaskSummary(task)}`,
            },
          ],
        };
      }

      if (action === "update") {
        const taskId = String(params.taskId ?? "").trim();
        if (!taskId) {
          throw new Error("taskId is required for update");
        }

        const currentTask = await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, "GET");
        const payload: Record<string, unknown> = {
          actorMatrixId,
        };

        if (typeof params.title === "string") payload.title = params.title;
        if (typeof params.description === "string") payload.description = params.description;
        if (typeof params.workItemType === "string") {
          const workItemType = parseWorkItemType(params.workItemType);
          if (!workItemType) {
            throw new Error(`Invalid workItemType: ${params.workItemType}`);
          }
          payload.workItemType = workItemType;
        }
        if (typeof params.status === "string") {
          const nextStatus = parseStatus(params.status);
          if (!nextStatus) {
            throw new Error(`Invalid status: ${params.status}`);
          }
          validateStatusTransition(currentTask.status, nextStatus);
          payload.status = nextStatus;
        }
        if (typeof params.priority === "string") {
          const priority = parsePriority(params.priority);
          if (!priority) {
            throw new Error(`Invalid priority: ${params.priority}`);
          }
          payload.priority = priority;
        }
        if (Array.isArray(params.tags)) payload.tags = params.tags.map((entry) => String(entry));
        if (typeof params.deliverable === "string") payload.deliverable = params.deliverable;
        if (typeof params.blockedReason === "string" || params.blockedReason === null) {
          payload.blockedReason = typeof params.blockedReason === "string" ? params.blockedReason.trim() : null;
        }
        if (typeof params.nextAction === "string" || params.nextAction === null) {
          payload.nextAction = typeof params.nextAction === "string" ? params.nextAction.trim() : null;
        }
        if (typeof params.blockerOwnerMatrixId === "string" || params.blockerOwnerMatrixId === null) {
          payload.blockerOwnerMatrixId =
            typeof params.blockerOwnerMatrixId === "string" && params.blockerOwnerMatrixId.trim()
              ? normalizeMatrixId(params.blockerOwnerMatrixId)
              : null;
        }
        if (typeof params.escalateToMatrixId === "string" || params.escalateToMatrixId === null) {
          payload.escalateToMatrixId =
            typeof params.escalateToMatrixId === "string" && params.escalateToMatrixId.trim()
              ? normalizeMatrixId(params.escalateToMatrixId)
              : null;
        }
        if (Object.prototype.hasOwnProperty.call(params, "parentTaskId")) {
          payload.parentTaskId =
            typeof params.parentTaskId === "string" && params.parentTaskId.trim()
              ? params.parentTaskId.trim()
              : null;
        }
        if (Object.prototype.hasOwnProperty.call(params, "assigneeMatrixId")) {
          payload.assigneeMatrixId =
            typeof params.assigneeMatrixId === "string" && params.assigneeMatrixId.trim()
              ? normalizeMatrixId(params.assigneeMatrixId)
              : null;
        }

        const nextStatus = (payload.status as TaskStatus | undefined) ?? currentTask.status;
        const nextBlockedReason =
          Object.prototype.hasOwnProperty.call(payload, "blockedReason")
            ? (payload.blockedReason as string | null)
            : (currentTask.blockedReason ?? null);
        const nextAction =
          Object.prototype.hasOwnProperty.call(payload, "nextAction")
            ? (payload.nextAction as string | null)
            : (currentTask.nextAction ?? null);
        if (nextStatus === "blocked") {
          if (!nextBlockedReason) {
            throw new Error("blockedReason is required when setting status=blocked");
          }
          if (!nextAction) {
            throw new Error("nextAction is required when setting status=blocked");
          }
        }

        const task = await commandCenterRequest<TaskRecord>(
          `/api/agent/tasks/${encodeURIComponent(taskId)}`,
          "PATCH",
          payload,
        );
        return {
          content: [
            {
              type: "text",
              text: `Updated task: ${formatTaskSummary(task)}`,
            },
          ],
        };
      }

      if (action === "comment") {
        const taskId = String(params.taskId ?? "").trim();
        const message = String(params.message ?? "").trim();
        if (!taskId) {
          throw new Error("taskId is required for comment");
        }
        if (!message) {
          throw new Error("message is required for comment");
        }

        const task = await commandCenterRequest<TaskRecord>(
          `/api/agent/tasks/${encodeURIComponent(taskId)}/comments`,
          "POST",
          {
            actorMatrixId,
            message,
          },
        );

        return {
          content: [
            {
              type: "text",
              text: `Comment added to ${task.id}. Total comments: ${task.comments.length}.`,
            },
          ],
        };
      }

      if (action === "escalate") {
        const taskId = String(params.taskId ?? "").trim();
        const reason = String(params.reason ?? "").trim();
        const nextAction = String(params.nextAction ?? "").trim();

        if (!taskId) {
          throw new Error("taskId is required for escalate");
        }
        if (!reason) {
          throw new Error("reason is required for escalate");
        }
        if (!nextAction) {
          throw new Error("nextAction is required for escalate");
        }

        const blockerOwnerMatrixId =
          typeof params.blockerOwnerMatrixId === "string" && params.blockerOwnerMatrixId.trim()
            ? normalizeMatrixId(params.blockerOwnerMatrixId)
            : null;
        const escalateToMatrixId =
          typeof params.escalateToMatrixId === "string" && params.escalateToMatrixId.trim()
            ? normalizeMatrixId(params.escalateToMatrixId)
            : null;
        const impact = typeof params.impact === "string" ? params.impact.trim() : "";
        const setBlocked = params.setBlocked !== false;

        let task = await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, "GET");

        if (setBlocked || task.status === "blocked") {
          task = await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, "PATCH", {
            actorMatrixId,
            status: setBlocked ? "blocked" : task.status,
            blockedReason: reason,
            nextAction,
            blockerOwnerMatrixId,
            escalateToMatrixId,
          });
        }

        const escalationMessage = buildEscalationMessage({
          actorMatrixId,
          reason,
          impact: impact || undefined,
          blockerOwnerMatrixId,
          escalateToMatrixId,
          nextAction,
        });

        await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}/comments`, "POST", {
          actorMatrixId,
          message: escalationMessage,
        });

        const refreshed = await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, "GET");
        return {
          content: [
            {
              type: "text",
              text: [
                `Escalated task: ${formatTaskSummary(refreshed)}`,
                `reason: ${reason}`,
                `nextAction: ${nextAction}`,
                `blockedOwner: ${blockerOwnerMatrixId ?? "unspecified"}`,
                `escalateTo: ${escalateToMatrixId ?? "unspecified"}`,
              ].join("\n"),
            },
          ],
        };
      }

      if (action === "attachments") {
        const taskId = String(params.taskId ?? "").trim();
        if (!taskId) {
          throw new Error("taskId is required for attachments");
        }

        const payload = await commandCenterRequest<AttachmentListResponse>(
          `/api/agent/tasks/${encodeURIComponent(taskId)}/attachments`,
          "GET",
        );

        const lines = payload.attachments.map(
          (entry) =>
            `${entry.id} | ${entry.fileName} | ${entry.contentType} | ${entry.sizeBytes} bytes | ${entry.sourceKind} | path=${entry.sharedPath} | by=${entry.createdByMatrixId} | at=${entry.createdAt}`,
        );
        return {
          content: [
            {
              type: "text",
              text: lines.length > 0 ? lines.join("\n") : "No attachments found",
            },
          ],
        };
      }

      if (action === "attach") {
        const taskId = String(params.taskId ?? "").trim();
        if (!taskId) {
          throw new Error("taskId is required for attach");
        }

        const filePath = parseOptionalString(params.filePath);
        const linkPathRaw = parseOptionalString(params.linkPath);
        if (!filePath && !linkPathRaw) {
          throw new Error("attach requires either filePath (upload) or linkPath (shared-link)");
        }
        if (filePath && linkPathRaw) {
          throw new Error("Provide only one of filePath or linkPath");
        }

        let task: TaskRecord;
        let attachedFileName = "attachment";
        let attachedContentType = "application/octet-stream";
        let attachedBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

        if (filePath) {
          const bytes = await readFile(filePath);
          if (bytes.byteLength <= 0) {
            throw new Error(`Attachment file is empty: ${filePath}`);
          }
          attachedFileName = parseOptionalString(params.fileName) ?? basename(filePath);
          attachedContentType = parseOptionalString(params.contentType) ?? contentTypeFromFileName(attachedFileName);
          attachedBytes = bytes;

          const form = new FormData();
          form.set("actorMatrixId", actorMatrixId);
          form.set("file", new Blob([bytes], { type: attachedContentType }), attachedFileName);
          task = await commandCenterFormRequest<TaskRecord>(
            `/api/agent/tasks/${encodeURIComponent(taskId)}/attachments`,
            "POST",
            form,
          );
        } else {
          const normalizedLinkPath = normalizeLinkPathForTask(linkPathRaw as string);
          const payload = {
            actorMatrixId,
            linkPath: normalizedLinkPath,
            ...(parseOptionalString(params.fileName) ? { fileName: parseOptionalString(params.fileName) } : {}),
            ...(parseOptionalString(params.contentType) ? { contentType: parseOptionalString(params.contentType) } : {}),
          };
          task = await commandCenterRequest<TaskRecord>(
            `/api/agent/tasks/${encodeURIComponent(taskId)}/attachments`,
            "POST",
            payload,
          );

          const listPayload = await commandCenterRequest<AttachmentListResponse>(
            `/api/agent/tasks/${encodeURIComponent(taskId)}/attachments`,
            "GET",
          );
          const linkedAttachment = listPayload.attachments.find((entry) => entry.sharedPath === normalizedLinkPath);
          if (linkedAttachment) {
            attachedFileName = linkedAttachment.fileName;
            attachedContentType = linkedAttachment.contentType || contentTypeFromFileName(linkedAttachment.fileName);
            const binary = await commandCenterBinaryRequest(
              `/api/agent/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(linkedAttachment.id)}?inline=true`,
            );
            attachedBytes = binary.bytes;
          }
        }

        const sendToMatrix = params.sendToMatrix === true;
        let matrixLine = "";
        if (sendToMatrix) {
          const roomId = parseOptionalString(params.roomId) ?? task.matrixRoomId ?? null;
          if (!roomId) {
            throw new Error("sendToMatrix=true requires roomId or task with matrixRoomId");
          }
          if (attachedBytes.byteLength <= 0) {
            throw new Error("sendToMatrix=true requires readable file content");
          }
          const threadRootEventId = parseOptionalString(params.threadRootEventId) ?? task.matrixThreadRootEventId ?? null;
          const matrixMessage =
            parseOptionalString(params.matrixMessage)
            ?? `[ATTACHMENT] ${attachedFileName} added to ${task.id} by ${actorMatrixId}`;
          const sent = await sendMatrixFileMessage({
            roomId,
            threadRootEventId,
            message: matrixMessage,
            fileName: attachedFileName,
            contentType: attachedContentType,
            bytes: attachedBytes,
          });
          matrixLine = `\nMatrix message sent: room=${roomId} event=${sent.eventId} uri=${sent.mxcUri}`;
        }

        return {
          content: [
            {
              type: "text",
              text: `Attached file to ${task.id}: ${attachedFileName} (${attachedContentType}, ${attachedBytes.byteLength} bytes).${matrixLine}`,
            },
          ],
        };
      }

      if (action === "matrix_file") {
        const taskId = parseOptionalString(params.taskId);
        const roomIdParam = parseOptionalString(params.roomId);
        const threadRootEventIdParam = parseOptionalString(params.threadRootEventId);
        const attachmentId = parseOptionalString(params.attachmentId);
        const filePath = parseOptionalString(params.filePath);

        let task: TaskRecord | null = null;
        if (taskId) {
          task = await commandCenterRequest<TaskRecord>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, "GET");
        }

        const roomId = roomIdParam ?? task?.matrixRoomId ?? null;
        if (!roomId) {
          throw new Error("matrix_file requires roomId or taskId with matrixRoomId");
        }
        const threadRootEventId = threadRootEventIdParam ?? task?.matrixThreadRootEventId ?? null;

        let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
        let fileName = parseOptionalString(params.fileName) ?? "attachment";
        let contentType = parseOptionalString(params.contentType) ?? "application/octet-stream";

        if (attachmentId) {
          if (!taskId) {
            throw new Error("attachmentId requires taskId");
          }
          const binary = await commandCenterBinaryRequest(
            `/api/agent/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}?inline=true`,
          );
          bytes = binary.bytes;
          fileName = parseOptionalString(params.fileName) ?? binary.fileName ?? attachmentId;
          contentType = parseOptionalString(params.contentType) ?? binary.contentType ?? contentTypeFromFileName(fileName);
        } else {
          if (!filePath) {
            throw new Error("matrix_file requires either filePath or attachmentId");
          }
          const buffer = await readFile(filePath);
          if (buffer.byteLength <= 0) {
            throw new Error(`File is empty: ${filePath}`);
          }
          bytes = buffer;
          fileName = parseOptionalString(params.fileName) ?? basename(filePath);
          contentType = parseOptionalString(params.contentType) ?? contentTypeFromFileName(fileName);
        }

        const matrixMessage = parseOptionalString(params.matrixMessage) ?? parseOptionalString(params.message) ?? fileName;
        const sent = await sendMatrixFileMessage({
          roomId,
          threadRootEventId,
          message: matrixMessage,
          fileName,
          contentType,
          bytes,
        });

        return {
          content: [
            {
              type: "text",
              text: [
                `Sent file to Matrix room ${roomId}`,
                `eventId: ${sent.eventId}`,
                `mxcUri: ${sent.mxcUri}`,
                `file: ${fileName} (${contentType}, ${bytes.byteLength} bytes)`,
                `threadRootEventId: ${threadRootEventId ?? "(none)"}`,
              ].join("\n"),
            },
          ],
        };
      }

      throw new Error(`Unsupported action: ${String(action)}`);
    },
  };
}
