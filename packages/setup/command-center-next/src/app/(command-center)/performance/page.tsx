import { PerformanceView } from "@/features/performance/components/performance-view";
import { loadDashboardSnapshot } from "@/lib/command-center/server";

export default async function PerformancePage() {
  const snapshot = await loadDashboardSnapshot();
  return <PerformanceView snapshot={snapshot} />;
}
