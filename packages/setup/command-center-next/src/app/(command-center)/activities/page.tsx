import { ActivitiesView } from "@/features/activities/components/activities-view";
import { loadDashboardSnapshot } from "@/lib/command-center/server";

export default async function ActivitiesPage() {
  const snapshot = await loadDashboardSnapshot();
  return <ActivitiesView events={snapshot.activity} source={snapshot.source} />;
}
