import { NextRequest, NextResponse } from "next/server";
import { actorMatrixIdFromPayload, commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const serviceToken = commandCenterServiceToken();
  const baseUrl = commandCenterBaseUrl();
  const query = request.nextUrl.search || "";

  if (serviceToken) {
    const response = await fetch(`${baseUrl}/api/agent/tasks${query}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-command-center-token": serviceToken,
      },
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

  const response = await fetch(`${baseUrl}/api/tasks${query}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    cache: "no-store",
  });

  return relayJsonResponse(response);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = actorMatrixIdFromPayload(payload, "@unknown:anycompany.corp");
  const serviceToken = commandCenterServiceToken();
  const baseUrl = commandCenterBaseUrl();

  const title = String(payload.title ?? "").trim();
  const deliverable = String(payload.deliverable ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!deliverable) {
    return NextResponse.json({ error: "deliverable is required" }, { status: 400 });
  }

  if (serviceToken) {
    const response = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-command-center-token": serviceToken,
      },
      body: JSON.stringify({
        actorMatrixId,
        title,
        description: String(payload.description ?? ""),
        workItemType: typeof payload.workItemType === "string" ? payload.workItemType : "task",
        priority: typeof payload.priority === "string" ? payload.priority : "medium",
        assigneeMatrixId: typeof payload.assigneeMatrixId === "string" && payload.assigneeMatrixId.trim()
          ? payload.assigneeMatrixId.trim()
          : null,
        parentTaskId: typeof payload.parentTaskId === "string" && payload.parentTaskId.trim()
          ? payload.parentTaskId.trim()
          : null,
        deliverable,
        blockedReason: typeof payload.blockedReason === "string" ? payload.blockedReason : null,
        nextAction: typeof payload.nextAction === "string" ? payload.nextAction : null,
        blockerOwnerMatrixId:
          typeof payload.blockerOwnerMatrixId === "string" && payload.blockerOwnerMatrixId.trim()
            ? payload.blockerOwnerMatrixId.trim()
            : null,
        escalateToMatrixId:
          typeof payload.escalateToMatrixId === "string" && payload.escalateToMatrixId.trim()
            ? payload.escalateToMatrixId.trim()
            : null,
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

  const response = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      title,
      description: String(payload.description ?? ""),
      workItemType: typeof payload.workItemType === "string" ? payload.workItemType : "task",
      priority: typeof payload.priority === "string" ? payload.priority : "medium",
      assigneeMatrixId: typeof payload.assigneeMatrixId === "string" && payload.assigneeMatrixId.trim()
        ? payload.assigneeMatrixId.trim()
        : null,
      parentTaskId: typeof payload.parentTaskId === "string" && payload.parentTaskId.trim()
        ? payload.parentTaskId.trim()
        : null,
      deliverable,
      blockedReason: typeof payload.blockedReason === "string" ? payload.blockedReason : null,
      nextAction: typeof payload.nextAction === "string" ? payload.nextAction : null,
      blockerOwnerMatrixId:
        typeof payload.blockerOwnerMatrixId === "string" && payload.blockerOwnerMatrixId.trim()
          ? payload.blockerOwnerMatrixId.trim()
          : null,
      escalateToMatrixId:
        typeof payload.escalateToMatrixId === "string" && payload.escalateToMatrixId.trim()
          ? payload.escalateToMatrixId.trim()
          : null,
    }),
    cache: "no-store",
  });

  return relayJsonResponse(response);
}
