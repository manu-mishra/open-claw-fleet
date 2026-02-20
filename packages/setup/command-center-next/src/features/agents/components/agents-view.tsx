"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AgentSummary } from "@/lib/command-center/types";

interface AgentsViewProps {
  agents: AgentSummary[];
}

function statusTone(status: string): "good" | "warn" | "neutral" {
  if (status === "working") {
    return "good";
  }
  if (status === "idle") {
    return "warn";
  }
  return "neutral";
}

export function AgentsView({ agents }: AgentsViewProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return agents;
    }

    return agents.filter((agent) => {
      const haystack = `${agent.name} ${agent.title} ${agent.department} ${agent.team ?? ""} ${agent.matrixId}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [agents, query]);

  return (
    <div className="cc-page">
      <Panel title="Agent Directory" subtitle={`${filtered.length} visible · ${agents.length} total`}>
        <label className="cc-field">
          <span>Search</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, title, department, or Matrix ID"
          />
        </label>

        <div className="cc-list">
          {filtered.map((agent) => (
            <article key={agent.matrixId} className="cc-list-item">
              <div>
                <strong>{agent.name}</strong>
                <p>
                  {agent.title} · {agent.department}
                  {agent.team ? ` · ${agent.team}` : ""}
                </p>
                <small>{agent.matrixId}</small>
              </div>
              <StatusBadge value={agent.status} tone={statusTone(agent.status)} />
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
