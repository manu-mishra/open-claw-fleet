import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";
import type { TaskPriority, TaskStatus, TaskWorkItemType } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const { taskId } = await context.params;
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const task = await commandCenterBackend.getTask(trimmedTaskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task, { status: 200 });
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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

  if (
    Object.prototype.hasOwnProperty.call(payload, "deliverable")
    && !String(payload.deliverable ?? "").trim()
  ) {
    return NextResponse.json({ error: "deliverable is required" }, { status: 400 });
  }

  const status = commandCenterBackend.parseTaskStatus(payload.status);
  if (Object.prototype.hasOwnProperty.call(payload, "status") && status === null) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const priority = commandCenterBackend.parseTaskPriority(payload.priority);
  if (Object.prototype.hasOwnProperty.call(payload, "priority") && priority === null) {
    return NextResponse.json({ error: "invalid priority" }, { status: 400 });
  }
  const workItemType = commandCenterBackend.parseTaskWorkItemType(payload.workItemType);
  if (Object.prototype.hasOwnProperty.call(payload, "workItemType") && workItemType === null) {
    return NextResponse.json({ error: "invalid workItemType" }, { status: 400 });
  }

  const update: {
    title?: string;
    description?: string;
    workItemType?: TaskWorkItemType;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeMatrixId?: string | null;
    parentTaskId?: string | null;
    tags?: string[];
    deliverable?: string;
    blockedReason?: string | null;
    nextAction?: string | null;
    blockerOwnerMatrixId?: string | null;
    escalateToMatrixId?: string | null;
  } = {};
  if (typeof payload.title === "string") {
    update.title = payload.title;
  }
  if (typeof payload.description === "string") {
    update.description = payload.description;
  }
  if (workItemType) {
    update.workItemType = workItemType;
  }
  if (status) {
    update.status = status;
  }
  if (priority) {
    update.priority = priority;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "assigneeMatrixId")) {
    update.assigneeMatrixId = payload.assigneeMatrixId ? String(payload.assigneeMatrixId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "parentTaskId")) {
    update.parentTaskId =
      typeof payload.parentTaskId === "string" && payload.parentTaskId.trim().length > 0
        ? payload.parentTaskId.trim()
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "tags")) {
    update.tags = commandCenterBackend.parseTaskTags(payload.tags);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "deliverable")) {
    update.deliverable = String(payload.deliverable);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "blockedReason")) {
    update.blockedReason = commandCenterBackend.parseOptionalText(payload.blockedReason);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "nextAction")) {
    update.nextAction = commandCenterBackend.parseOptionalText(payload.nextAction);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "blockerOwnerMatrixId")) {
    const matrixId = commandCenterBackend.parseNullableMatrixId(payload.blockerOwnerMatrixId);
    if (
      typeof payload.blockerOwnerMatrixId === "string"
      && payload.blockerOwnerMatrixId.trim().length > 0
      && !matrixId
    ) {
      return NextResponse.json({ error: "invalid blockerOwnerMatrixId" }, { status: 400 });
    }
    update.blockerOwnerMatrixId = matrixId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "escalateToMatrixId")) {
    const matrixId = commandCenterBackend.parseNullableMatrixId(payload.escalateToMatrixId);
    if (
      typeof payload.escalateToMatrixId === "string"
      && payload.escalateToMatrixId.trim().length > 0
      && !matrixId
    ) {
      return NextResponse.json({ error: "invalid escalateToMatrixId" }, { status: 400 });
    }
    update.escalateToMatrixId = matrixId;
  }

  try {
    const task = await commandCenterBackend.updateTask(trimmedTaskId, update, actorMatrixId);
    return NextResponse.json(task, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update task";
    const statusCode =
      message === "Task not found"
        ? 404
        : message.includes("required")
          || message.includes("parentTaskId")
          || message.includes("cycle")
          || message.includes("own parent")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
