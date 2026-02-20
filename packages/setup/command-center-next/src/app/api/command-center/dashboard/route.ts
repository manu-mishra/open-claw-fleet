import { NextRequest, NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/command-center/repository";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieHeader = request.headers.get("cookie") ?? undefined;
  const snapshot = await getDashboardSnapshot(cookieHeader);
  return NextResponse.json(snapshot, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
