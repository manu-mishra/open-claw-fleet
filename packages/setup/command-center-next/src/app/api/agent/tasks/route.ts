import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const params = request.nextUrl.searchParams;

  try {
    const payload = await commandCenterBackend.listTasks({
      status: params.get("status"),
      workItemType: params.get("workItemType"),
      parentTaskId: params.get("parentTaskId"),
      includeDone: params.get("includeDone"),
      assigneeMatrixId: params.get("assigneeMatrixId"),
      creatorMatrixId: params.get("creatorMatrixId"),
      query: params.get("query"),
      limit: params.get("limit"),
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list tasks";
    const status = message.includes("invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = commandCenterBackend.parseActorMatrixId(payload.actorMatrixId);
  if (!actorMatrixId) {
    return NextResponse.json({ error: "actorMatrixId is required" }, { status: 400 });
  }

  const title = String(payload.title ?? "").trim();
  const deliverable = String(payload.deliverable ?? "").trim();

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!deliverable) {
    return NextResponse.json({ error: "deliverable is required" }, { status: 400 });
  }

  const priority = commandCenterBackend.parseTaskPriority(payload.priority) ?? "medium";
  const workItemType = commandCenterBackend.parseTaskWorkItemType(payload.workItemType) ?? "task";
  const parentTaskId =
    Object.prototype.hasOwnProperty.call(payload, "parentTaskId")
      ? typeof payload.parentTaskId === "string" && payload.parentTaskId.trim().length > 0
        ? payload.parentTaskId.trim()
        : null
      : undefined;

  try {
    const task = await commandCenterBackend.createTask(
      {
        title,
        description: String(payload.description ?? ""),
        workItemType,
        priority,
        parentTaskId,
        assigneeMatrixId: payload.assigneeMatrixId ? String(payload.assigneeMatrixId) : null,
        tags: commandCenterBackend.parseTaskTags(payload.tags),
        deliverable,
        blockedReason: commandCenterBackend.parseOptionalText(payload.blockedReason),
        nextAction: commandCenterBackend.parseOptionalText(payload.nextAction),
        blockerOwnerMatrixId: commandCenterBackend.parseNullableMatrixId(payload.blockerOwnerMatrixId),
        escalateToMatrixId: commandCenterBackend.parseNullableMatrixId(payload.escalateToMatrixId),
      },
      actorMatrixId,
    );

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create task";
    const status =
      message.includes("required")
      || message.includes("parentTaskId")
      || message.includes("cycle")
      || message.includes("own parent")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
