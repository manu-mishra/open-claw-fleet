"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "@/components/ui/metric-card";
import { Panel } from "@/components/ui/panel";
import { CreateTaskModal } from "@/features/dashboard/components/create-task-modal";
import { DashboardFilters } from "@/features/dashboard/components/dashboard-filters";
import { TaskColumn } from "@/features/dashboard/components/task-column";
import { TaskDetailsModal } from "@/features/dashboard/components/task-details-modal";
import { normalizeTask } from "@/lib/command-center/repository";
import type { DashboardSnapshot, DirectoryPerson, Task, WorkItemType } from "@/lib/command-center/types";

interface DashboardViewProps {
  snapshot: DashboardSnapshot;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function taskMatchesDepartment(task: Task, department: string): boolean {
  if (!department) {
    return true;
  }
  if (task.department === department) {
    return true;
  }
  if (Array.isArray(task.departments) && task.departments.includes(department)) {
    return true;
  }
  return task.workItemType === "epic" && task.department === "Cross-Department";
}

async function readError(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const message = payload.error;
    return typeof message === "string" && message.trim().length > 0 ? message : fallback;
  } catch {
    return fallback;
  }
}

export function DashboardView({ snapshot }: DashboardViewProps) {
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [activity, setActivity] = useState(snapshot.activity);
  const [agents, setAgents] = useState(snapshot.agents);
  const [statuses, setStatuses] = useState(snapshot.statuses);
  const [priorities, setPriorities] = useState(snapshot.priorities);
  const [currentUser, setCurrentUser] = useState(snapshot.currentUser);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(snapshot.tasks[0]?.id ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalDefaultParentTaskId, setCreateModalDefaultParentTaskId] = useState<string | null>(null);
  const [createModalSeed, setCreateModalSeed] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const [workItemType, setWorkItemType] = useState<"all" | WorkItemType>("all");
  const [department, setDepartment] = useState("");
  const [vp, setVp] = useState("");
  const [director, setDirector] = useState("");
  const [manager, setManager] = useState("");

  const departments = useMemo(() => {
    const values: string[] = [];
    for (const task of tasks) {
      values.push(task.department);
      if (task.departments?.length) {
        values.push(...task.departments);
      }
    }
    return uniqueSorted(values);
  }, [tasks]);

  const typeAndDepartmentTasks = useMemo(() => {
    return tasks.filter((task) => {
      const typeMatch = workItemType === "all" || task.workItemType === workItemType;
      return typeMatch && taskMatchesDepartment(task, department);
    });
  }, [tasks, workItemType, department]);

  const vpOptions = useMemo(() => uniqueSorted(typeAndDepartmentTasks.map((task) => task.vp)), [typeAndDepartmentTasks]);
  const directorOptions = useMemo(() => {
    const scope = typeAndDepartmentTasks.filter((task) => !vp || task.vp === vp);
    return uniqueSorted(scope.map((task) => task.director));
  }, [typeAndDepartmentTasks, vp]);
  const managerOptions = useMemo(() => {
    const scope = typeAndDepartmentTasks.filter((task) => (!vp || task.vp === vp) && (!director || task.director === director));
    return uniqueSorted(scope.map((task) => task.manager));
  }, [typeAndDepartmentTasks, vp, director]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const typeMatch = workItemType === "all" || task.workItemType === workItemType;
      if (!typeMatch) {
        return false;
      }
      if (!taskMatchesDepartment(task, department)) {
        return false;
      }
      if (vp && task.vp !== vp) {
        return false;
      }
      if (director && task.director !== director) {
        return false;
      }
      if (manager && task.manager !== manager) {
        return false;
      }
      return true;
    });
  }, [tasks, workItemType, department, vp, director, manager]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) ?? null, [selectedTaskId, tasks]);
  const parentTask = useMemo(() => {
    if (!selectedTask?.parentTaskId) {
      return null;
    }
    return tasks.find((task) => task.id === selectedTask.parentTaskId) ?? null;
  }, [tasks, selectedTask]);
  const childTasks = useMemo(() => {
    if (!selectedTask) {
      return [];
    }
    return tasks.filter((task) => task.parentTaskId === selectedTask.id);
  }, [tasks, selectedTask]);
  const childCountByParentId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) {
      if (!task.parentTaskId) {
        continue;
      }
      counts[task.parentTaskId] = (counts[task.parentTaskId] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  const metrics = useMemo(() => {
    return {
      totalTasks: filteredTasks.length,
      inProgress: filteredTasks.filter((task) => task.status === "in_progress").length,
      review: filteredTasks.filter((task) => task.status === "review").length,
      completed: filteredTasks.filter((task) => task.status === "done").length,
      activeAgents: agents.filter((agent) => agent.status === "working" || agent.status === "idle").length,
    };
  }, [filteredTasks, agents]);

  const boardStatuses = useMemo(() => {
    const ordered = ["blocked", "inbox", "assigned", "in_progress", "review", "done"];
    const available = Array.from(new Set(statuses.map((entry) => String(entry)).filter((entry) => entry.length > 0)));
    return available.sort((a, b) => {
      const ai = ordered.indexOf(a);
      const bi = ordered.indexOf(b);
      const left = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const right = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (left !== right) {
        return left - right;
      }
      return a.localeCompare(b);
    });
  }, [statuses]);

  const refreshDashboard = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/command-center/dashboard", {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`dashboard refresh failed (${response.status})`);
    }

    const payload = (await response.json()) as DashboardSnapshot;
    if (!payload || typeof payload !== "object") {
      throw new Error("dashboard refresh payload invalid");
    }

    if (Array.isArray(payload.tasks)) {
      setTasks(payload.tasks);
    }
    if (Array.isArray(payload.activity)) {
      setActivity(payload.activity);
    }
    if (Array.isArray(payload.agents)) {
      setAgents(payload.agents);
    }
    if (Array.isArray(payload.statuses) && payload.statuses.length > 0) {
      setStatuses(payload.statuses);
    }
    if (Array.isArray(payload.priorities) && payload.priorities.length > 0) {
      setPriorities(payload.priorities);
    }
    if (typeof payload.currentUser === "string" && payload.currentUser.trim().length > 0) {
      setCurrentUser(payload.currentUser);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;
    let refreshQueued = false;

    const runRefresh = async () => {
      if (!active) {
        return;
      }
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      try {
        await refreshDashboard();
      } catch {
        // keep SSE connection alive; next update will refresh state.
      } finally {
        refreshInFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          void runRefresh();
        }
      }
    };

    const eventSource = new EventSource("/api/command-center/events");
    eventSource.addEventListener("connected", () => {
      if (!active) {
        return;
      }
      void runRefresh();
    });
    eventSource.addEventListener("dashboard_update", () => {
      if (!active) {
        return;
      }
      void runRefresh();
    });
    eventSource.addEventListener("keepalive", () => undefined);
    eventSource.onerror = () => undefined;

    return () => {
      active = false;
      eventSource.close();
    };
  }, [refreshDashboard]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    const present = tasks.some((task) => task.id === selectedTaskId);
    if (!present) {
      setSelectedTaskId(tasks[0]?.id ?? null);
    }
  }, [tasks, selectedTaskId]);

  function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    setModalOpen(true);
  }

  function openCreateTask(): void {
    setCreateModalDefaultParentTaskId(null);
    setCreateModalSeed((value) => value + 1);
    setCreateModalOpen(true);
  }

  function openCreateChildTask(parentTask: Task): void {
    setCreateModalDefaultParentTaskId(parentTask.id);
    setCreateModalSeed((value) => value + 1);
    setModalOpen(false);
    setCreateModalOpen(true);
  }

  function upsertTask(task: Task): void {
    setTasks((existing) => {
      const found = existing.some((entry) => entry.id === task.id);
      if (!found) {
        return [task, ...existing];
      }
      return existing.map((entry) => (entry.id === task.id ? task : entry));
    });
  }

  function addLocalActivity(taskId: string, message: string): void {
    const now = new Date().toISOString();
    setActivity((existing) => [
      {
        id: `event_local_${taskId}_${now}`,
        taskId,
        actorMatrixId: currentUser,
        message,
        createdAt: now,
      },
      ...existing,
    ]);
  }

  async function searchPeople(query: string): Promise<DirectoryPerson[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }

    try {
      const response = await fetch(`/api/command-center/people/search?q=${encodeURIComponent(trimmed)}&limit=8`, {
        method: "GET",
      });
      if (response.ok) {
        const payload = (await response.json()) as { results?: DirectoryPerson[] };
        if (Array.isArray(payload.results)) {
          return payload.results;
        }
      }
    } catch {
      // Fall through to local filtering.
    }

    return agents
      .filter((agent) => {
        const searchable = `${agent.name} ${agent.title} ${agent.department} ${agent.matrixId}`.toLowerCase();
        return searchable.includes(trimmed);
      })
      .slice(0, 8)
      .map((agent) => ({
        name: agent.name,
        title: agent.title,
        department: agent.department,
        matrixId: agent.matrixId,
      }));
  }

  async function createTask(payload: {
    title: string;
    description: string;
    workItemType: string;
    deliverable: string;
    priority: string;
    assigneeMatrixId: string | null;
    parentTaskId?: string | null;
  }): Promise<void> {
    setActionError(null);
    const response = await fetch("/api/command-center/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actorMatrixId: currentUser,
        ...payload,
      }),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const raw = (await response.json()) as unknown;
    const createdTask = normalizeTask(raw);
    if (!createdTask) {
      throw new Error("Failed to parse created task");
    }

    upsertTask(createdTask);
    addLocalActivity(createdTask.id, `${currentUser} created ${createdTask.id}`);
    setSelectedTaskId(createdTask.id);
    setModalOpen(true);
  }

  async function updateTask(taskId: string, payload: Record<string, unknown>): Promise<void> {
    setActionError(null);
    const response = await fetch(`/api/command-center/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actorMatrixId: currentUser,
        ...payload,
      }),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const raw = (await response.json()) as unknown;
    const updatedTask = normalizeTask(raw);
    if (!updatedTask) {
      throw new Error("Failed to parse updated task");
    }
    upsertTask(updatedTask);
  }

  async function moveTask(taskId: string, nextStatus: string): Promise<void> {
    const current = tasks.find((task) => task.id === taskId);
    if (!current || current.status === nextStatus) {
      return;
    }

    try {
      await updateTask(taskId, { status: nextStatus });
      addLocalActivity(taskId, `Status changed: ${current.status} -> ${nextStatus}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to move task";
      setActionError(message);
      alert(message);
    }
  }

  async function saveTask(
    taskId: string,
    payload: {
      status: string;
      workItemType: WorkItemType;
      priority: string;
      assigneeMatrixId: string | null;
      parentTaskId: string | null;
      deliverable: string;
      blockedReason: string | null;
      nextAction: string | null;
      blockerOwnerMatrixId: string | null;
      escalateToMatrixId: string | null;
    },
  ): Promise<void> {
    await updateTask(taskId, payload);
    addLocalActivity(taskId, `${currentUser} updated ${taskId}`);
  }

  async function addComment(taskId: string, message: string): Promise<void> {
    setActionError(null);
    const response = await fetch(`/api/command-center/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actorMatrixId: currentUser,
        message,
      }),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const raw = (await response.json()) as unknown;
    const updatedTask = normalizeTask(raw);
    if (!updatedTask) {
      throw new Error("Failed to parse updated task after comment");
    }
    upsertTask(updatedTask);
  }

  return (
    <div className="cc-page">
      <div className="cc-metrics">
        <MetricCard label="Visible Tasks" value={metrics.totalTasks} />
        <MetricCard label="In Progress" value={metrics.inProgress} />
        <MetricCard label="Review" value={metrics.review} />
        <MetricCard label="Done" value={metrics.completed} />
        <MetricCard label="Active Agents" value={metrics.activeAgents} />
      </div>

      <Panel className="cc-panel--filters" title="Scope Filters">
        <DashboardFilters
          workItemType={workItemType}
          onWorkItemTypeChange={(value) => setWorkItemType(value)}
          department={department}
          onDepartmentChange={(value) => {
            setDepartment(value);
            setVp("");
            setDirector("");
            setManager("");
          }}
          vp={vp}
          onVpChange={(value) => {
            setVp(value);
            setDirector("");
            setManager("");
          }}
          director={director}
          onDirectorChange={(value) => {
            setDirector(value);
            setManager("");
          }}
          manager={manager}
          onManagerChange={setManager}
          departments={departments}
          vps={vpOptions}
          directors={directorOptions}
          managers={managerOptions}
          onReset={() => {
            setWorkItemType("all");
            setDepartment("");
            setVp("");
            setDirector("");
            setManager("");
          }}
        />
      </Panel>

      <Panel
        className="cc-panel--board"
        title="Mission Queue"
        actions={
          <div className="cc-inline-actions">
            {selectedTask ? (
              <button type="button" className="cc-button is-secondary" onClick={() => openCreateChildTask(selectedTask)}>
                New Child Task
              </button>
            ) : null}
            <button type="button" className="cc-button" onClick={openCreateTask}>
              New Task
            </button>
          </div>
        }
      >
        <div className="cc-board-scroll">
          <div className="cc-board">
            {boardStatuses.map((status) => {
              const columnTasks = filteredTasks.filter((task) => task.status === status);
              return (
                <TaskColumn
                  key={status}
                  status={status}
                  tasks={columnTasks}
                  childCountByParentId={childCountByParentId}
                  selectedTaskId={selectedTaskId}
                  onSelect={openTask}
                  onMove={moveTask}
                />
              );
            })}
          </div>
        </div>
      </Panel>

      {actionError ? <p className="cc-status-text">{actionError}</p> : null}

      <TaskDetailsModal
        open={modalOpen}
        task={selectedTask}
        allTasks={tasks}
        parentTask={parentTask}
        childTasks={childTasks}
        activity={activity}
        statuses={statuses}
        priorities={priorities}
        onSaveTask={saveTask}
        onAddComment={addComment}
        onSearchPeople={searchPeople}
        onOpenTask={openTask}
        onCreateChildTask={openCreateChildTask}
        onClose={() => setModalOpen(false)}
      />

      <CreateTaskModal
        open={createModalOpen}
        tasks={tasks}
        priorities={priorities}
        defaultParentTaskId={createModalDefaultParentTaskId}
        seed={createModalSeed}
        onSearchPeople={searchPeople}
        onCreate={createTask}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
  );
}
