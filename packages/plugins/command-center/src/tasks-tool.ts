import { Type } from "@sinclair/typebox";

type TaskAction = "list" | "get" | "create" | "update" | "comment" | "escalate";
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
}

interface CommandCenterListResponse {
  count: number;
  total: number;
  limit: number;
  tasks: TaskRecord[];
}

const COMMAND_CENTER_URL = (process.env.COMMAND_CENTER_URL || "http://command-center:8090").replace(/\/+$/, "");
const COMMAND_CENTER_API_TOKEN = process.env.COMMAND_CENTER_API_TOKEN || "";
const COMMAND_CENTER_TIMEOUT_MS = Number.parseInt(process.env.COMMAND_CENTER_TIMEOUT_MS || "10000", 10);
const MATRIX_DOMAIN = process.env.MATRIX_DOMAIN || "anycompany.corp";
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

export function createTasksTool() {
  return {
    name: "tasks",
    description:
      "Manage Command Center work items (epic, feature, story, task) across stages (inbox, assigned, in_progress, review, done, blocked). Actions: list, get, create, update, comment, escalate.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("list"),
          Type.Literal("get"),
          Type.Literal("create"),
          Type.Literal("update"),
          Type.Literal("comment"),
          Type.Literal("escalate"),
        ],
        { description: "Task action: list, get, create, update, comment, escalate" },
      ),
      taskId: Type.Optional(Type.String({ description: "Task ID for get/update/comment/escalate" })),
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
      query: Type.Optional(Type.String({ description: "Free text search in list action" })),
      limit: Type.Optional(Type.Number({ description: "Max list results (default 20, max 200)" })),
      includeDone: Type.Optional(Type.Boolean({ description: "Include done tasks in list (default true)" })),
      mine: Type.Optional(Type.Boolean({ description: "Shortcut for list: assignee=actor" })),
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

      throw new Error(`Unsupported action: ${String(action)}`);
    },
  };
}
