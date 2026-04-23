export type TaskStatus =
  | "inbox"
  | "assigned"
  | "in_progress"
  | "review"
  | "done"
  | "blocked"
  | string;

export type TaskPriority = "low" | "medium" | "high" | "urgent" | string;
export type WorkItemType = "epic" | "feature" | "story" | "task" | string;

export type AgentStatus = "working" | "idle" | "external" | string;

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
  workItemType: WorkItemType;
  parentTaskId: string | null;
  ownerMatrixId?: string | null;
  ownerName?: string;
  department: string;
  departments?: string[];
  team?: string;
  vp: string;
  director: string;
  manager: string;
  status: TaskStatus;
  priority: TaskPriority;
  creatorMatrixId: string;
  assigneeMatrixId: string | null;
  deliverable: string;
  blockedReason?: string | null;
  blockerOwnerMatrixId?: string | null;
  escalateToMatrixId?: string | null;
  nextAction?: string | null;
  matrixRoomId?: string | null;
  matrixThreadRootEventId?: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TaskComment[];
  attachments?: TaskAttachment[];
}

export interface AgentSummary {
  matrixId: string;
  name: string;
  title: string;
  department: string;
  team?: string;
  status: AgentStatus;
}

export interface DirectoryPerson {
  name: string;
  title: string;
  department: string;
  matrixId: string;
  raw?: string;
}

export interface ActivityEvent {
  id: string;
  taskId: string | null;
  actorMatrixId: string;
  message: string;
  createdAt: string;
}

export interface DashboardTotals {
  totalTasks: number;
  inProgress: number;
  review: number;
  completed: number;
  activeAgents: number;
}

export interface DashboardSnapshot {
  currentUser: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  totals: DashboardTotals;
  tasks: Task[];
  agents: AgentSummary[];
  activity: ActivityEvent[];
  source: "live" | "mock";
  fetchedAt: string;
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
