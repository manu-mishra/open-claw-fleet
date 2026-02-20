import { AgentsView } from "@/features/agents/components/agents-view";
import { loadDashboardSnapshot } from "@/lib/command-center/server";

export default async function AgentsPage() {
  const snapshot = await loadDashboardSnapshot();
  return <AgentsView agents={snapshot.agents} />;
}
