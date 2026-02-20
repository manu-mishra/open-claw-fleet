import { NextRequest, NextResponse } from "next/server";
import { actorMatrixIdFromPayload, commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = actorMatrixIdFromPayload(payload, "@unknown:anycompany.corp");
  const serviceToken = commandCenterServiceToken();
  const baseUrl = commandCenterBaseUrl();

  const updatePayload: Record<string, unknown> = {};
  if (typeof payload.title === "string") updatePayload.title = payload.title;
  if (typeof payload.description === "string") updatePayload.description = payload.description;
  if (typeof payload.workItemType === "string") updatePayload.workItemType = payload.workItemType;
  if (typeof payload.status === "string") updatePayload.status = payload.status;
  if (typeof payload.priority === "string") updatePayload.priority = payload.priority;
  if (typeof payload.deliverable === "string") updatePayload.deliverable = payload.deliverable;
  if (typeof payload.blockedReason === "string" || payload.blockedReason === null) {
    updatePayload.blockedReason = payload.blockedReason;
  }
  if (typeof payload.nextAction === "string" || payload.nextAction === null) {
    updatePayload.nextAction = payload.nextAction;
  }
  if (typeof payload.blockerOwnerMatrixId === "string" || payload.blockerOwnerMatrixId === null) {
    updatePayload.blockerOwnerMatrixId =
      typeof payload.blockerOwnerMatrixId === "string" && payload.blockerOwnerMatrixId.trim()
        ? payload.blockerOwnerMatrixId.trim()
        : null;
  }
  if (typeof payload.escalateToMatrixId === "string" || payload.escalateToMatrixId === null) {
    updatePayload.escalateToMatrixId =
      typeof payload.escalateToMatrixId === "string" && payload.escalateToMatrixId.trim()
        ? payload.escalateToMatrixId.trim()
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "assigneeMatrixId")) {
    updatePayload.assigneeMatrixId =
      typeof payload.assigneeMatrixId === "string" && payload.assigneeMatrixId.trim()
        ? payload.assigneeMatrixId.trim()
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "parentTaskId")) {
    updatePayload.parentTaskId =
      typeof payload.parentTaskId === "string" && payload.parentTaskId.trim()
        ? payload.parentTaskId.trim()
        : null;
  }

  if (serviceToken) {
    const response = await fetch(`${baseUrl}/api/agent/tasks/${encodeURIComponent(trimmedTaskId)}`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-command-center-token": serviceToken,
      },
      body: JSON.stringify({
        actorMatrixId,
        ...updatePayload,
      }),
      cache: "no-store",
    });

    return relayJsonResponse(response);
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return NextResponse.json(
      { error: "Authentication required: missing command-center session cookie or COMMAND_CENTER_API_TOKEN" },
      { status: 401 },
    );
  }

  const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(trimmedTaskId)}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(updatePayload),
    cache: "no-store",
  });

  return relayJsonResponse(response);
}
