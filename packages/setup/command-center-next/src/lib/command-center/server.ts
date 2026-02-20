import { cookies } from "next/headers";
import { getDashboardSnapshot } from "@/lib/command-center/repository";
import type { DashboardSnapshot } from "@/lib/command-center/types";

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  return getDashboardSnapshot(cookieHeader || undefined);
}
