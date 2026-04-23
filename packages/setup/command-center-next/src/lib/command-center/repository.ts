import { MOCK_DASHBOARD } from "@/lib/command-center/mock-data";
import type {
  ActivityEvent,
  AgentSummary,
  DashboardSnapshot,
  DashboardTotals,
  Task,
  TaskPriority,
  TaskStatus,
  WorkItemType,
} from "@/lib/command-center/types";

const DEFAULT_STATUSES: TaskStatus[] = ["inbox", "assigned", "in_progress", "review", "done", "blocked"];
const DEFAULT_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

function serviceToken(): string {
  return (process.env.COMMAND_CENTER_API_TOKEN ?? process.env.FLEET_SECRET ?? "").trim();
}

export function normalizeTask(candidate: unknown): Task | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const entry = candidate as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.title !== "string") {
    return null;
  }

  const comments = Array.isArray(entry.comments)
    ? entry.comments
        .map((comment) => {
          if (!comment || typeof comment !== "object") {
            return null;
          }
          const value = comment as Record<string, unknown>;
          if (
            typeof value.id !== "string" ||
            typeof value.authorMatrixId !== "string" ||
            typeof value.message !== "string" ||
            typeof value.createdAt !== "string"
          ) {
            return null;
          }
          return {
            id: value.id,
            authorMatrixId: value.authorMatrixId,
            message: value.message,
            createdAt: value.createdAt,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
    : [];

  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== "object") {
            return null;
          }
          const value = attachment as Record<string, unknown>;
          if (
            typeof value.id !== "string"
            || typeof value.fileName !== "string"
            || typeof value.contentType !== "string"
            || typeof value.sizeBytes !== "number"
            || typeof value.sharedPath !== "string"
            || typeof value.createdAt !== "string"
            || typeof value.createdByMatrixId !== "string"
          ) {
            return null;
          }
          return {
            id: value.id,
            fileName: value.fileName,
            contentType: value.contentType,
            sizeBytes: value.sizeBytes,
            sharedPath: value.sharedPath,
            sourceKind: value.sourceKind === "link" ? ("link" as const) : ("upload" as const),
            createdAt: value.createdAt,
            createdByMatrixId: value.createdByMatrixId,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
    : [];

  return {
    id: entry.id,
    title: entry.title,
    description: typeof entry.description === "string" ? entry.description : "",
    workItemType: typeof entry.workItemType === "string" ? (entry.workItemType as WorkItemType) : "task",
    parentTaskId: typeof entry.parentTaskId === "string" ? entry.parentTaskId : null,
    ownerMatrixId: typeof entry.ownerMatrixId === "string" ? entry.ownerMatrixId : null,
    ownerName: typeof entry.ownerName === "string" ? entry.ownerName : undefined,
    department: typeof entry.department === "string" ? entry.department : "Unknown",
    departments: Array.isArray(entry.departments)
      ? entry.departments.filter((value): value is string => typeof value === "string")
      : undefined,
    team: typeof entry.team === "string" ? entry.team : "Unknown",
    vp: typeof entry.vp === "string" ? entry.vp : "Unknown",
    director: typeof entry.director === "string" ? entry.director : "Unknown",
    manager: typeof entry.manager === "string" ? entry.manager : "Unknown",
    status: typeof entry.status === "string" ? entry.status : "inbox",
    priority: typeof entry.priority === "string" ? entry.priority : "medium",
    creatorMatrixId: typeof entry.creatorMatrixId === "string" ? entry.creatorMatrixId : "@unknown:anycompany.corp",
    assigneeMatrixId: typeof entry.assigneeMatrixId === "string" ? entry.assigneeMatrixId : null,
    deliverable: typeof entry.deliverable === "string" ? entry.deliverable : "",
    blockedReason: typeof entry.blockedReason === "string" ? entry.blockedReason : null,
    blockerOwnerMatrixId: typeof entry.blockerOwnerMatrixId === "string" ? entry.blockerOwnerMatrixId : null,
    escalateToMatrixId: typeof entry.escalateToMatrixId === "string" ? entry.escalateToMatrixId : null,
    nextAction: typeof entry.nextAction === "string" ? entry.nextAction : null,
    matrixRoomId: typeof entry.matrixRoomId === "string" ? entry.matrixRoomId : null,
    matrixThreadRootEventId: typeof entry.matrixThreadRootEventId === "string" ? entry.matrixThreadRootEventId : null,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
    comments,
    attachments,
  };
}

function normalizeAgent(candidate: unknown): AgentSummary | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const entry = candidate as Record<string, unknown>;
  if (typeof entry.matrixId !== "string") {
    return null;
  }
  return {
    matrixId: entry.matrixId,
    name: typeof entry.name === "string" ? entry.name : entry.matrixId,
    title: typeof entry.title === "string" ? entry.title : "Unknown",
    department: typeof entry.department === "string" ? entry.department : "Unknown",
    team: typeof entry.team === "string" ? entry.team : undefined,
    status: typeof entry.status === "string" ? entry.status : "external",
  };
}

function normalizeActivity(candidate: unknown): ActivityEvent | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const entry = candidate as Record<string, unknown>;
  if (typeof entry.id !== "string") {
    return null;
  }

  return {
    id: entry.id,
    taskId: typeof entry.taskId === "string" ? entry.taskId : null,
    actorMatrixId: typeof entry.actorMatrixId === "string" ? entry.actorMatrixId : "@unknown:anycompany.corp",
    message: typeof entry.message === "string" ? entry.message : "No message",
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
  };
}

function normalizeTotals(candidate: unknown, tasks: Task[], agents: AgentSummary[]): DashboardTotals {
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const review = tasks.filter((task) => task.status === "review").length;
  const completed = tasks.filter((task) => task.status === "done").length;
  const activeAgents = agents.filter((agent) => agent.status === "working" || agent.status === "idle").length;

  if (!candidate || typeof candidate !== "object") {
    return {
      totalTasks: tasks.length,
      inProgress,
      review,
      completed,
      activeAgents,
    };
  }

  const entry = candidate as Record<string, unknown>;
  return {
    totalTasks: typeof entry.totalTasks === "number" ? entry.totalTasks : tasks.length,
    inProgress: typeof entry.inProgress === "number" ? entry.inProgress : inProgress,
    review: typeof entry.review === "number" ? entry.review : review,
    completed: typeof entry.completed === "number" ? entry.completed : completed,
    activeAgents: typeof entry.activeAgents === "number" ? entry.activeAgents : activeAgents,
  };
}

function normalizeSnapshot(payload: unknown, source: "live" | "mock"): DashboardSnapshot {
  if (!payload || typeof payload !== "object") {
    return {
      ...MOCK_DASHBOARD,
      source: "mock",
      fetchedAt: new Date().toISOString(),
    };
  }

  const entry = payload as Record<string, unknown>;
  const tasks = Array.isArray(entry.tasks)
    ? entry.tasks.map(normalizeTask).filter((task): task is Task => Boolean(task))
    : MOCK_DASHBOARD.tasks;
  const agents = Array.isArray(entry.agents)
    ? entry.agents.map(normalizeAgent).filter((agent): agent is AgentSummary => Boolean(agent))
    : MOCK_DASHBOARD.agents;
  const activity = Array.isArray(entry.activity)
    ? entry.activity.map(normalizeActivity).filter((event): event is ActivityEvent => Boolean(event))
    : MOCK_DASHBOARD.activity;

  const statuses = Array.isArray(entry.statuses)
    ? entry.statuses.filter((status): status is TaskStatus => typeof status === "string")
    : DEFAULT_STATUSES;
  const priorities = Array.isArray(entry.priorities)
    ? entry.priorities.filter((priority): priority is TaskPriority => typeof priority === "string")
    : DEFAULT_PRIORITIES;

  return {
    currentUser: typeof entry.currentUser === "string" ? entry.currentUser : MOCK_DASHBOARD.currentUser,
    statuses: statuses.length ? statuses : DEFAULT_STATUSES,
    priorities: priorities.length ? priorities : DEFAULT_PRIORITIES,
    totals: normalizeTotals(entry.totals, tasks, agents),
    tasks,
    agents,
    activity,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

function commandCenterBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_COMMAND_CENTER_API_BASE_URL ?? "http://localhost:8090").replace(/\/+$/, "");
}

function parseDirectoryLine(line: string): {
  name: string;
  title: string;
  department: string;
  matrixId: string;
} | null {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length < 4) {
    return null;
  }
  const [name, title, department, matrixId] = parts;
  if (!matrixId.startsWith("@")) {
    return null;
  }
  return { name, title, department, matrixId };
}

async function fetchServiceDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  const token = serviceToken();
  if (!token) {
    return null;
  }

  const baseUrl = commandCenterBaseUrl();
  const dashboardResponse = await fetch(`${baseUrl}/api/agent/dashboard`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-command-center-token": token,
    },
    cache: "no-store",
  });

  if (dashboardResponse.ok) {
    const dashboardPayload = (await dashboardResponse.json()) as unknown;
    return normalizeSnapshot(dashboardPayload, "live");
  }

  const tasksResponse = await fetch(`${baseUrl}/api/agent/tasks?limit=200&includeDone=true`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-command-center-token": token,
    },
    cache: "no-store",
  });

  if (!tasksResponse.ok) {
    return null;
  }

  const tasksPayload = (await tasksResponse.json()) as { tasks?: unknown[] };
  const tasks = Array.isArray(tasksPayload.tasks)
    ? tasksPayload.tasks.map(normalizeTask).filter((task): task is Task => Boolean(task))
    : [];

  const peopleByMatrixId = new Map<string, { name: string; title: string; department: string }>();
  try {
    const peopleResponse = await fetch(`${baseUrl}/api/people/query`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-command-center-token": token,
      },
      body: JSON.stringify({
        action: "search",
        query: "",
        limit: 100,
      }),
      cache: "no-store",
    });

    if (peopleResponse.ok) {
      const payload = (await peopleResponse.json()) as { results?: unknown[] };
      const lines = Array.isArray(payload.results) ? payload.results.map((value) => String(value)) : [];
      for (const line of lines) {
        const parsed = parseDirectoryLine(line);
        if (!parsed) {
          continue;
        }
        peopleByMatrixId.set(parsed.matrixId, {
          name: parsed.name,
          title: parsed.title,
          department: parsed.department,
        });
      }
    }
  } catch {
    // People enrichment is optional for service fallback.
  }

  const workingStatuses = new Set<TaskStatus>(["assigned", "in_progress", "review"]);
  const agentStatusMap = new Map<string, "working" | "idle" | "external">();
  for (const task of tasks) {
    const ids = [task.creatorMatrixId, task.assigneeMatrixId].filter((value): value is string => Boolean(value));
    for (const matrixId of ids) {
      const nextStatus: "working" | "idle" = task.assigneeMatrixId === matrixId && workingStatuses.has(task.status) ? "working" : "idle";
      const current = agentStatusMap.get(matrixId);
      if (current === "working" || (current === "idle" && nextStatus === "idle")) {
        continue;
      }
      agentStatusMap.set(matrixId, nextStatus);
    }
  }

  const agents: AgentSummary[] = Array.from(agentStatusMap.entries())
    .map(([matrixId, status]) => {
      const person = peopleByMatrixId.get(matrixId);
      return {
        matrixId,
        name: person?.name ?? matrixId,
        title: person?.title ?? "Agent",
        department: person?.department ?? "Unassigned",
        status,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const review = tasks.filter((task) => task.status === "review").length;
  const completed = tasks.filter((task) => task.status === "done").length;
  const activeAgents = agents.filter((agent) => agent.status === "working" || agent.status === "idle").length;

  return {
    currentUser: tasks[0]?.creatorMatrixId ?? "@unknown:anycompany.corp",
    statuses: DEFAULT_STATUSES,
    priorities: DEFAULT_PRIORITIES,
    totals: {
      totalTasks: tasks.length,
      inProgress,
      review,
      completed,
      activeAgents,
    },
    tasks,
    agents,
    activity: [],
    source: "live",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getDashboardSnapshot(cookieHeader?: string): Promise<DashboardSnapshot> {
  const serviceSnapshot = await fetchServiceDashboardSnapshot();
  if (serviceSnapshot) {
    return serviceSnapshot;
  }

  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  try {
    const response = await fetch(`${commandCenterBaseUrl()}/api/dashboard`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`dashboard request failed (${response.status})`);
    }

    const payload = (await response.json()) as unknown;
    return normalizeSnapshot(payload, "live");
  } catch {
    return {
      ...MOCK_DASHBOARD,
      source: "mock",
      fetchedAt: new Date().toISOString(),
    };
  }
}
