import { NextRequest, NextResponse } from "next/server";
import { actorMatrixIdFromPayload, commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const message = String(payload.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const actorMatrixId = actorMatrixIdFromPayload(payload, "@unknown:anycompany.corp");
  const serviceToken = commandCenterServiceToken();
  const baseUrl = commandCenterBaseUrl();

  if (serviceToken) {
    const response = await fetch(`${baseUrl}/api/agent/tasks/${encodeURIComponent(trimmedTaskId)}/comments`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-command-center-token": serviceToken,
      },
      body: JSON.stringify({
        actorMatrixId,
        message,
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

  const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(trimmedTaskId)}/comments`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ message }),
    cache: "no-store",
  });

  return relayJsonResponse(response);
}
