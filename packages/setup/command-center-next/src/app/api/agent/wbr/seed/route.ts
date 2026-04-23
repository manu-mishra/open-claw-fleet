import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = commandCenterBackend.parseActorMatrixId(payload.actorMatrixId);
  if (!actorMatrixId) {
    return NextResponse.json({ error: "actorMatrixId is required" }, { status: 400 });
  }

  const weekStart = typeof payload.weekStart === "string" ? payload.weekStart : null;

  try {
    const result = await commandCenterBackend.seedWeeklyBusinessReviews(actorMatrixId, weekStart);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to seed WBR tasks";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
