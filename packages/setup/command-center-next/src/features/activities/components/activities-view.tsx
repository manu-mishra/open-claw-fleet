"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/panel";
import type { ActivityEvent, DashboardSnapshot } from "@/lib/command-center/types";
import { formatTimestamp } from "@/lib/utils/time";

interface ActivitiesViewProps {
  events: ActivityEvent[];
  source: "live" | "mock";
}

type RealtimeState = "connecting" | "live" | "reconnecting";

export function ActivitiesView({ events, source }: ActivitiesViewProps) {
  const [activityEvents, setActivityEvents] = useState(events);
  const [dataSource, setDataSource] = useState(source);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");

  useEffect(() => {
    let active = true;

    const refreshEvents = async () => {
      const response = await fetch("/api/command-center/dashboard", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`activity refresh failed (${response.status})`);
      }

      const payload = (await response.json()) as DashboardSnapshot;
      if (!active) {
        return;
      }
      if (Array.isArray(payload.activity)) {
        setActivityEvents(payload.activity);
      }
      if (payload.source === "live" || payload.source === "mock") {
        setDataSource(payload.source);
      }
    };

    const eventSource = new EventSource("/api/command-center/events");
    eventSource.addEventListener("connected", () => {
      if (!active) {
        return;
      }
      setRealtimeState("live");
      void refreshEvents().catch(() => {
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
      void refreshEvents().catch(() => {
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

  const sorted = useMemo(() => {
    return [...activityEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activityEvents]);

  return (
    <div className="cc-page">
      <Panel
        title="Live Activity Feed"
        subtitle={`${dataSource === "live" ? "Live updates from command-center backend" : "Mock feed (backend session unavailable)"} · Realtime: ${realtimeState}`}
      >
        <div className="cc-list">
          {sorted.map((event) => (
            <article key={event.id} className="cc-list-item">
              <div>
                <strong>{event.actorMatrixId}</strong>
                <p>{event.message}</p>
                <small>
                  {event.taskId ? `Task: ${event.taskId} · ` : ""}
                  {formatTimestamp(event.createdAt)}
                </small>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
