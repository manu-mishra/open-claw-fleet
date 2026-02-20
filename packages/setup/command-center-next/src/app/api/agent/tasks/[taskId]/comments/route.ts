import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const { taskId } = await context.params;
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = commandCenterBackend.parseActorMatrixId(payload.actorMatrixId);
  if (!actorMatrixId) {
    return NextResponse.json({ error: "actorMatrixId is required" }, { status: 400 });
  }

  const message = String(payload.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const task = await commandCenterBackend.addComment(trimmedTaskId, message, actorMatrixId);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    const text = error instanceof Error ? error.message : "Failed to add comment";
    const statusCode = text === "Task not found" ? 404 : 500;
    return NextResponse.json({ error: text }, { status: statusCode });
  }
}
