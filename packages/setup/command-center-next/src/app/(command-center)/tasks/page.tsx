import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { loadDashboardSnapshot } from "@/lib/command-center/server";

export default async function TasksPage() {
  const snapshot = await loadDashboardSnapshot();
  return <DashboardView snapshot={snapshot} />;
}
