"use client";

import { useEffect, useMemo, useState } from "react";
import { MetricCard } from "@/components/ui/metric-card";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WbrDepartmentSummary, WbrWeeklySummary } from "@/lib/command-center/types";
import { formatTimestamp } from "@/lib/utils/time";

type RealtimeState = "connecting" | "live" | "reconnecting";

interface WbrViewProps {
  currentUser: string;
}

interface WbrSummaryResponse extends WbrWeeklySummary {
  error?: string;
}

function startOfIsoWeekUtcDate(input: Date): string {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function emptySummary(weekStart: string): WbrWeeklySummary {
  return {
    weekStart,
    generatedAt: new Date().toISOString(),
    totals: {
      departments: 0,
      expectedDirectors: 0,
      totalEntries: 0,
      submitted: 0,
      pending: 0,
      blocked: 0,
      overdue: 0,
    },
    departments: [],
  };
}

function statusTone(value: string): "neutral" | "good" | "warn" | "alert" {
  if (value === "done" || value === "review") {
    return "good";
  }
  if (value === "blocked") {
    return "alert";
  }
  if (value === "assigned" || value === "in_progress") {
    return "warn";
  }
  return "neutral";
}

function departmentCompletionRatio(department: WbrDepartmentSummary): string {
  const expected = Math.max(0, department.expectedDirectors);
  if (expected === 0) {
    return `${department.submitted}/${department.totalEntries}`;
  }
  return `${department.submitted}/${expected}`;
}

function departmentCompletionPct(department: WbrDepartmentSummary): number {
  const expected = Math.max(0, department.expectedDirectors);
  if (expected <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((department.submitted / expected) * 100)));
}

export function WbrView({ currentUser }: WbrViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfIsoWeekUtcDate(new Date()));
  const [summary, setSummary] = useState<WbrWeeklySummary>(() => emptySummary(startOfIsoWeekUtcDate(new Date())));
  const [selectedDepartment, setSelectedDepartment] = useState<string>("");
  const [statusText, setStatusText] = useState("Loading weekly business review summary...");
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");

  async function refreshSummary(targetWeek: string): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch(`/api/command-center/wbr/summary?weekStart=${encodeURIComponent(targetWeek)}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as WbrSummaryResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to load WBR summary (${response.status})`);
      }

      setSummary(payload);
      setStatusText(`WBR summary updated ${formatTimestamp(payload.generatedAt)}.`);
      setSelectedDepartment((previous) => {
        if (previous && payload.departments.some((entry) => entry.department === previous)) {
          return previous;
        }
        return payload.departments[0]?.department ?? "";
      });
    } catch (error) {
      setSummary(emptySummary(targetWeek));
      setStatusText(error instanceof Error ? error.message : "Failed to load WBR summary.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSeedWeek(): Promise<void> {
    setSeeding(true);
    setStatusText("Generating weekly business review tasks...");
    try {
      const response = await fetch("/api/command-center/wbr/seed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actorMatrixId: currentUser,
          weekStart,
        }),
      });
      const payload = (await response.json()) as { error?: string; created?: number; existing?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to seed WBR tasks (${response.status})`);
      }

      const created = Number(payload.created ?? 0);
      const existing = Number(payload.existing ?? 0);
      setStatusText(`WBR tasks ready: created ${created}, existing ${existing}.`);
      await refreshSummary(weekStart);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to seed WBR tasks.");
    } finally {
      setSeeding(false);
    }
  }

  useEffect(() => {
    void refreshSummary(weekStart);
  }, [weekStart]);

  useEffect(() => {
    let active = true;

    const eventSource = new EventSource("/api/command-center/events");
    const onDashboardUpdate = () => {
      if (!active) {
        return;
      }
      setRealtimeState("live");
      void refreshSummary(weekStart).catch(() => {
        if (active) {
          setRealtimeState("reconnecting");
        }
      });
    };

    eventSource.addEventListener("connected", onDashboardUpdate);
    eventSource.addEventListener("dashboard_update", onDashboardUpdate);
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
  }, [weekStart]);

  const selected = useMemo(() => {
    if (!selectedDepartment) {
      return summary.departments[0] ?? null;
    }
    return summary.departments.find((entry) => entry.department === selectedDepartment) ?? null;
  }, [summary.departments, selectedDepartment]);

  return (
    <div className="cc-page cc-wbr-page">
      <Panel
        title="Weekly Business Review"
        subtitle="CEO dashboard grouped by department with Director -> VP review flow."
        actions={(
          <div className="cc-inline-actions">
            <span className={`cc-badge ${realtimeState === "live" ? "is-good" : "is-warn"}`}>
              {realtimeState === "live" ? "Realtime Live" : "Realtime Reconnecting"}
            </span>
            <button type="button" className="cc-button" onClick={handleSeedWeek} disabled={seeding}>
              {seeding ? "Generating..." : "Generate Week Tasks"}
            </button>
          </div>
        )}
      >
        <div className="cc-filters-horizontal cc-wbr-controls">
          <label className="cc-filter-inline-field cc-wbr-week-field">
            <span>Week Start</span>
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
              disabled={seeding}
            />
          </label>
          <p className="cc-status-text">{loading ? "Refreshing..." : statusText}</p>
        </div>
      </Panel>

      <section className="cc-metrics">
        <MetricCard label="Departments" value={summary.totals.departments} />
        <MetricCard label="Expected Directors" value={summary.totals.expectedDirectors} />
        <MetricCard label="Submitted (Review/Done)" value={summary.totals.submitted} />
        <MetricCard label="Pending" value={summary.totals.pending} />
        <MetricCard label="Blocked" value={summary.totals.blocked} />
        <MetricCard label="Overdue" value={summary.totals.overdue} />
      </section>

      <Panel title="Department Rollup" subtitle="Click a department to drill down to submitted entries and current status.">
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>VP</th>
                <th>Coverage</th>
                <th>Submitted</th>
                <th>Pending</th>
                <th>Blocked</th>
                <th>Overdue</th>
                <th>Last Update</th>
              </tr>
            </thead>
            <tbody>
              {summary.departments.map((department) => {
                const active = selected?.department === department.department;
                return (
                  <tr
                    key={department.department}
                    className={active ? "cc-wbr-row is-active" : "cc-wbr-row"}
                    onClick={() => setSelectedDepartment(department.department)}
                  >
                    <td>
                      <strong>{department.department}</strong>
                    </td>
                    <td>{department.vpMatrixId ?? "Unassigned"}</td>
                    <td>
                      <strong>{departmentCompletionRatio(department)}</strong>
                      <small>{departmentCompletionPct(department)}%</small>
                    </td>
                    <td>{department.submitted}</td>
                    <td>{department.pending}</td>
                    <td>{department.blocked}</td>
                    <td>{department.overdue}</td>
                    <td>{department.latestUpdatedAt ? formatTimestamp(department.latestUpdatedAt) : "No updates"}</td>
                  </tr>
                );
              })}
              {summary.departments.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <p className="cc-empty-copy">No weekly business review tasks found for this week.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={selected ? `${selected.department} Drilldown` : "Department Drilldown"}
        subtitle={selected ? `Director entries for week ${summary.weekStart}` : "Select a department to inspect WBR entries."}
      >
        {!selected || selected.entries.length === 0 ? (
          <p className="cc-empty-copy">No entries yet.</p>
        ) : (
          <div className="cc-list">
            {selected.entries.map((entry) => (
              <article key={entry.taskId} className="cc-list-item">
                <div>
                  <p>{entry.title}</p>
                  <small>
                    {entry.taskId} | Director: {entry.assigneeName} ({entry.assigneeMatrixId ?? "unassigned"})
                  </small>
                  <small>VP: {entry.vpMatrixId ?? selected.vpMatrixId ?? "unassigned"}</small>
                </div>
                <div className="cc-inline-actions">
                  <small>{formatTimestamp(entry.updatedAt)}</small>
                  <StatusBadge value={entry.status} tone={statusTone(entry.status)} />
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
