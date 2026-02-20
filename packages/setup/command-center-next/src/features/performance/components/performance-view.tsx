"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MetricCard } from "@/components/ui/metric-card";
import { Panel } from "@/components/ui/panel";
import type { AgentSummary, DashboardSnapshot, Task, WorkItemType } from "@/lib/command-center/types";
import { formatTimestamp } from "@/lib/utils/time";

type RealtimeState = "connecting" | "live" | "reconnecting";

interface PerformanceViewProps {
  snapshot: DashboardSnapshot;
}

type WorkItemTypeFilter = "all" | WorkItemType;

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_COLORS: Record<string, string> = {
  blocked: "#d6526b",
  inbox: "#7aa4d7",
  assigned: "#f2b152",
  in_progress: "#2d89d6",
  review: "#9157dd",
  done: "#28a66d",
};
const WORK_ITEM_FILTER_OPTIONS: WorkItemTypeFilter[] = ["all", "epic", "feature", "story", "task"];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value !== "Unknown"))].sort((a, b) => a.localeCompare(b));
}

function toDayAge(isoTimestamp: string): number {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / DAY_MS));
}

function isCompletedWithinDays(task: Task, days: number): boolean {
  if (task.status !== "done") {
    return false;
  }
  const parsed = Date.parse(task.updatedAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Date.now() - parsed <= days * DAY_MS;
}

function normalizeSearchInput(value: string): string {
  return value.trim().toLowerCase();
}

function matchesBaseFilters(
  task: Task,
  filters: {
    department: string;
    vp: string;
    director: string;
    manager: string;
    workItemType: WorkItemTypeFilter;
  },
): boolean {
  if (filters.department && task.department !== filters.department) {
    return false;
  }
  if (filters.vp && task.vp !== filters.vp) {
    return false;
  }
  if (filters.director && task.director !== filters.director) {
    return false;
  }
  if (filters.manager && task.manager !== filters.manager) {
    return false;
  }
  if (filters.workItemType !== "all" && task.workItemType !== filters.workItemType) {
    return false;
  }
  return true;
}

function renderChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string | number; value?: string | number; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="cc-chart-tooltip">
      {label ? <strong>{String(label)}</strong> : null}
      {payload.map((entry) => (
        <p key={`${entry.name}-${entry.color}`}>
          <span className="cc-chart-tooltip-dot" style={{ background: entry.color ?? "#90a9c8" }} />
          {String(entry.name)}: {entry.value ?? 0}
        </p>
      ))}
    </div>
  );
}

export function PerformanceView({ snapshot }: PerformanceViewProps) {
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks);
  const [agents, setAgents] = useState<AgentSummary[]>(snapshot.agents);
  const [source, setSource] = useState(snapshot.source);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");

  const [departmentFilter, setDepartmentFilter] = useState("");
  const [vpFilter, setVpFilter] = useState("");
  const [directorFilter, setDirectorFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [workItemTypeFilter, setWorkItemTypeFilter] = useState<WorkItemTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [taskQuery, setTaskQuery] = useState("");

  useEffect(() => {
    let active = true;

    const refreshSnapshot = async () => {
      const response = await fetch("/api/command-center/dashboard", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`performance refresh failed (${response.status})`);
      }

      const payload = (await response.json()) as DashboardSnapshot;
      if (!active) {
        return;
      }
      if (Array.isArray(payload.tasks)) {
        setTasks(payload.tasks);
      }
      if (Array.isArray(payload.agents)) {
        setAgents(payload.agents);
      }
      if (payload.source === "live" || payload.source === "mock") {
        setSource(payload.source);
      }
    };

    const eventSource = new EventSource("/api/command-center/events");
    eventSource.addEventListener("connected", () => {
      if (!active) {
        return;
      }
      setRealtimeState("live");
      void refreshSnapshot().catch(() => {
        if (active) {
          setRealtimeState("reconnecting");
        }
      });
    });
    eventSource.addEventListener("dashboard_update", () => {
      if (!active) {
        return;
      }
      setRealtimeState("live");
      void refreshSnapshot().catch(() => {
        if (active) {
          setRealtimeState("reconnecting");
        }
      });
    });
    eventSource.addEventListener("keepalive", () => {
      if (active) {
        setRealtimeState("live");
      }
    });
    eventSource.onerror = () => {
      if (active) {
        setRealtimeState("reconnecting");
      }
    };

    return () => {
      active = false;
      eventSource.close();
    };
  }, []);

  const departmentOptions = useMemo(() => uniqueSorted(tasks.map((task) => task.department)), [tasks]);
  const vpOptions = useMemo(() => {
    return uniqueSorted(
      tasks
        .filter((task) => (!departmentFilter || task.department === departmentFilter))
        .map((task) => task.vp),
    );
  }, [tasks, departmentFilter]);
  const directorOptions = useMemo(() => {
    return uniqueSorted(
      tasks
        .filter((task) => (!departmentFilter || task.department === departmentFilter) && (!vpFilter || task.vp === vpFilter))
        .map((task) => task.director),
    );
  }, [tasks, departmentFilter, vpFilter]);
  const managerOptions = useMemo(() => {
    return uniqueSorted(
      tasks
        .filter((task) => {
          return (
            (!departmentFilter || task.department === departmentFilter)
            && (!vpFilter || task.vp === vpFilter)
            && (!directorFilter || task.director === directorFilter)
          );
        })
        .map((task) => task.manager),
    );
  }, [tasks, departmentFilter, vpFilter, directorFilter]);

  const baseFilteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      return matchesBaseFilters(task, {
        department: departmentFilter,
        vp: vpFilter,
        director: directorFilter,
        manager: managerFilter,
        workItemType: workItemTypeFilter,
      });
    });
  }, [tasks, departmentFilter, vpFilter, directorFilter, managerFilter, workItemTypeFilter]);

  const normalizedTaskQuery = useMemo(() => normalizeSearchInput(taskQuery), [taskQuery]);

  const drilldownTasks = useMemo(() => {
    return baseFilteredTasks
      .filter((task) => (statusFilter ? task.status === statusFilter : true))
      .filter((task) => {
        if (!normalizedTaskQuery) {
          return true;
        }
        const searchable = `${task.id} ${task.title} ${task.description} ${task.ownerName ?? ""} ${task.assigneeMatrixId ?? ""} ${task.creatorMatrixId}`.toLowerCase();
        return searchable.includes(normalizedTaskQuery);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [baseFilteredTasks, statusFilter, normalizedTaskQuery]);

  const kpis = useMemo(() => {
    const completed7d = baseFilteredTasks.filter((task) => isCompletedWithinDays(task, 7)).length;
    const inProgress = baseFilteredTasks.filter((task) => task.status === "in_progress").length;
    const blocked = baseFilteredTasks.filter((task) => task.status === "blocked").length;

    const activeAgents = agents.filter((agent) => {
      const active = agent.status === "working" || agent.status === "idle";
      if (!active) {
        return false;
      }
      if (!departmentFilter) {
        return true;
      }
      return agent.department === departmentFilter;
    }).length;

    return { completed7d, inProgress, blocked, activeAgents };
  }, [agents, baseFilteredTasks, departmentFilter]);

  const departmentThroughputData = useMemo(() => {
    const map = new Map<string, { department: string; completed7d: number; inProgress: number; blocked: number }>();
    for (const task of baseFilteredTasks) {
      const key = task.department || "Unassigned";
      const current = map.get(key) ?? { department: key, completed7d: 0, inProgress: 0, blocked: 0 };
      if (isCompletedWithinDays(task, 7)) {
        current.completed7d += 1;
      }
      if (task.status === "in_progress") {
        current.inProgress += 1;
      }
      if (task.status === "blocked") {
        current.blocked += 1;
      }
      map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.completed7d !== a.completed7d) {
        return b.completed7d - a.completed7d;
      }
      return a.department.localeCompare(b.department);
    });
  }, [baseFilteredTasks]);

  const statusDistributionData = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of baseFilteredTasks) {
      map.set(task.status, (map.get(task.status) ?? 0) + 1);
    }

    return Array.from(map.entries())
      .map(([status, count]) => ({
        status,
        count,
        fill: STATUS_COLORS[status] ?? "#8ca1ba",
      }))
      .sort((a, b) => b.count - a.count);
  }, [baseFilteredTasks]);

  const agingByDepartmentData = useMemo(() => {
    const map = new Map<string, { department: string; age0to2: number; age3to7: number; age8plus: number }>();
    for (const task of baseFilteredTasks) {
      if (task.status === "done") {
        continue;
      }
      const key = task.department || "Unassigned";
      const current = map.get(key) ?? { department: key, age0to2: 0, age3to7: 0, age8plus: 0 };
      const age = toDayAge(task.createdAt);
      if (age <= 2) {
        current.age0to2 += 1;
      } else if (age <= 7) {
        current.age3to7 += 1;
      } else {
        current.age8plus += 1;
      }
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => a.department.localeCompare(b.department));
  }, [baseFilteredTasks]);

  const activeFilterCount = [departmentFilter, vpFilter, directorFilter, managerFilter, statusFilter, normalizedTaskQuery].filter(
    (value) => Boolean(value),
  ).length + (workItemTypeFilter === "all" ? 0 : 1);

  return (
    <div className="cc-page cc-performance-page">
      <div className="cc-metrics">
        <MetricCard label="Completed (7d)" value={kpis.completed7d} />
        <MetricCard label="In Progress" value={kpis.inProgress} />
        <MetricCard label="Blocked" value={kpis.blocked} />
        <MetricCard label="Active Agents" value={kpis.activeAgents} />
      </div>

      <Panel
        title="Performance Scope"
        subtitle={`${source === "live" ? "Live backend data" : "Mock data"} · Realtime: ${realtimeState} · Active filters: ${activeFilterCount}`}
        actions={
          <button
            type="button"
            className="cc-button is-secondary"
            onClick={() => {
              setDepartmentFilter("");
              setVpFilter("");
              setDirectorFilter("");
              setManagerFilter("");
              setWorkItemTypeFilter("all");
              setStatusFilter("");
              setTaskQuery("");
            }}
          >
            Clear Filters
          </button>
        }
      >
        <div className="cc-filters-horizontal">
          <label className="cc-filter-inline-field">
            <span>Department</span>
            <select
              value={departmentFilter}
              onChange={(event) => {
                setDepartmentFilter(event.target.value);
                setVpFilter("");
                setDirectorFilter("");
                setManagerFilter("");
              }}
            >
              <option value="">All</option>
              {departmentOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-filter-inline-field">
            <span>VP</span>
            <select
              value={vpFilter}
              onChange={(event) => {
                setVpFilter(event.target.value);
                setDirectorFilter("");
                setManagerFilter("");
              }}
            >
              <option value="">All</option>
              {vpOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-filter-inline-field">
            <span>Director</span>
            <select
              value={directorFilter}
              onChange={(event) => {
                setDirectorFilter(event.target.value);
                setManagerFilter("");
              }}
            >
              <option value="">All</option>
              {directorOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-filter-inline-field">
            <span>Manager</span>
            <select value={managerFilter} onChange={(event) => setManagerFilter(event.target.value)}>
              <option value="">All</option>
              {managerOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-filter-inline-field">
            <span>Work Type</span>
            <select value={workItemTypeFilter} onChange={(event) => setWorkItemTypeFilter(event.target.value as WorkItemTypeFilter)}>
              {WORK_ITEM_FILTER_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All" : value}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-filter-inline-field cc-filter-inline-field--search">
            <span>Search Task</span>
            <input
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
              placeholder="Task title, ID, owner"
            />
          </label>
        </div>

        <div className="cc-status-chip-row">
          {statusDistributionData.map((entry) => {
            const active = statusFilter === entry.status;
            return (
              <button
                key={entry.status}
                type="button"
                className={active ? "cc-status-chip is-active" : "cc-status-chip"}
                onClick={() => setStatusFilter((current) => (current === entry.status ? "" : entry.status))}
              >
                <span className="cc-status-chip-dot" style={{ background: entry.fill }} />
                {entry.status}
                <strong>{entry.count}</strong>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="cc-performance-grid">
        <Panel className="cc-panel--chart" title="Department Throughput (7d)">
          <div className="cc-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentThroughputData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cc-throughput-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2a83d5" stopOpacity={0.95} />
                    <stop offset="95%" stopColor="#72b2f3" stopOpacity={0.78} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e5f7" />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip content={renderChartTooltip} />
                <Legend />
                <Bar
                  dataKey="completed7d"
                  name="Completed (7d)"
                  fill="url(#cc-throughput-grad)"
                  radius={[6, 6, 0, 0]}
                  onClick={(_, index) => {
                    const target = departmentThroughputData[index];
                    if (!target) {
                      return;
                    }
                    setDepartmentFilter((current) => (current === target.department ? "" : target.department));
                    setVpFilter("");
                    setDirectorFilter("");
                    setManagerFilter("");
                  }}
                >
                  {departmentThroughputData.map((entry) => (
                    <Cell
                      key={entry.department}
                      cursor="pointer"
                      opacity={!departmentFilter || departmentFilter === entry.department ? 1 : 0.45}
                    />
                  ))}
                </Bar>
                <Bar dataKey="inProgress" name="In Progress" fill="#3f9be9" radius={[6, 6, 0, 0]} />
                <Bar dataKey="blocked" name="Blocked" fill="#d66173" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="cc-panel--chart" title="Status Distribution">
          <div className="cc-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={renderChartTooltip} />
                <Legend />
                <Pie
                  data={statusDistributionData}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={54}
                  outerRadius={88}
                  paddingAngle={2}
                  onClick={(entry) => {
                    const clickedStatus = String(entry?.status ?? "");
                    if (!clickedStatus) {
                      return;
                    }
                    setStatusFilter((current) => (current === clickedStatus ? "" : clickedStatus));
                  }}
                >
                  {statusDistributionData.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={entry.fill}
                      cursor="pointer"
                      opacity={!statusFilter || statusFilter === entry.status ? 1 : 0.4}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="cc-panel--chart cc-panel--chart-wide" title="Task Aging By Department">
          <div className="cc-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingByDepartmentData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e5f7" />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip content={renderChartTooltip} />
                <Legend />
                <Bar dataKey="age0to2" stackId="aging" name="0-2d" fill="#6ab8ff" radius={[6, 6, 0, 0]} />
                <Bar dataKey="age3to7" stackId="aging" name="3-7d" fill="#f2b35a" />
                <Bar dataKey="age8plus" stackId="aging" name="8d+" fill="#d66173" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        title="Drill-Down Tasks"
        subtitle={`${drilldownTasks.length} tasks · click throughput bars and status slices to narrow`}
      >
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Age</th>
                <th>Department</th>
                <th>Owner</th>
                <th>VP</th>
                <th>Manager</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {drilldownTasks.length ? (
                drilldownTasks.slice(0, 120).map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.title}</strong>
                      <small>{task.id}</small>
                    </td>
                    <td>{task.workItemType}</td>
                    <td>
                      <span className={`cc-table-status cc-table-status--${task.status}`}>{task.status}</span>
                    </td>
                    <td>{task.priority}</td>
                    <td className="cc-table-age">{toDayAge(task.createdAt)}d</td>
                    <td>{task.department}</td>
                    <td>{task.ownerName ?? task.assigneeMatrixId ?? task.creatorMatrixId}</td>
                    <td>{task.vp}</td>
                    <td>{task.manager}</td>
                    <td>{formatTimestamp(task.updatedAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10}>
                    <p className="cc-empty-copy">No tasks match the active filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
