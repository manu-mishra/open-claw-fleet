import { NextRequest, NextResponse } from "next/server";
import { actorMatrixIdFromPayload, commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const serviceToken = commandCenterServiceToken();
  if (!serviceToken) {
    return NextResponse.json({ error: "COMMAND_CENTER_API_TOKEN is required for attachments API" }, { status: 401 });
  }

  const baseUrl = commandCenterBaseUrl();
  const response = await fetch(`${baseUrl}/api/agent/tasks/${encodeURIComponent(trimmedTaskId)}/attachments`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-command-center-token": serviceToken,
    },
    cache: "no-store",
  });

  return relayJsonResponse(response);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const serviceToken = commandCenterServiceToken();
  if (!serviceToken) {
    return NextResponse.json({ error: "COMMAND_CENTER_API_TOKEN is required for attachments API" }, { status: 401 });
  }

  const baseUrl = commandCenterBaseUrl();
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const actorRaw = form.get("actorMatrixId");
    const actorMatrixId = actorMatrixIdFromPayload({ actorMatrixId: typeof actorRaw === "string" ? actorRaw : null }, "@unknown:anycompany.corp");
    if (!form.get("actorMatrixId")) {
      form.set("actorMatrixId", actorMatrixId);
    }

    const response = await fetch(`${baseUrl}/api/agent/tasks/${encodeURIComponent(trimmedTaskId)}/attachments`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-command-center-token": serviceToken,
      },
      body: form,
      cache: "no-store",
    });

    return relayJsonResponse(response);
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = actorMatrixIdFromPayload(payload, "@unknown:anycompany.corp");
  const response = await fetch(`${baseUrl}/api/agent/tasks/${encodeURIComponent(trimmedTaskId)}/attachments`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-command-center-token": serviceToken,
    },
    body: JSON.stringify({
      ...payload,
      actorMatrixId,
    }),
    cache: "no-store",
  });

  return relayJsonResponse(response);
}
