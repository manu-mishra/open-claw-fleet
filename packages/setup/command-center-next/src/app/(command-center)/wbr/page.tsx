import { WbrView } from "@/features/wbr/components/wbr-view";
import { loadDashboardSnapshot } from "@/lib/command-center/server";

export default async function WbrPage() {
  const snapshot = await loadDashboardSnapshot();
  return <WbrView currentUser={snapshot.currentUser} />;
}
