import { NextRequest, NextResponse } from "next/server";
import { commandCenterBaseUrl, commandCenterServiceToken } from "@/app/api/command-center/_utils";

interface RouteContext {
  params: Promise<{ taskId: string; attachmentId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { taskId, attachmentId } = await context.params;
  const trimmedTaskId = taskId.trim();
  const trimmedAttachmentId = attachmentId.trim();
  if (!trimmedTaskId || !trimmedAttachmentId) {
    return NextResponse.json({ error: "taskId and attachmentId are required" }, { status: 400 });
  }

  const serviceToken = commandCenterServiceToken();
  if (!serviceToken) {
    return NextResponse.json({ error: "COMMAND_CENTER_API_TOKEN is required for attachments API" }, { status: 401 });
  }

  const baseUrl = commandCenterBaseUrl();
  const inline = request.nextUrl.searchParams.get("inline");
  const query = inline ? `?inline=${encodeURIComponent(inline)}` : "";
  const upstream = await fetch(
    `${baseUrl}/api/agent/tasks/${encodeURIComponent(trimmedTaskId)}/attachments/${encodeURIComponent(trimmedAttachmentId)}${query}`,
    {
      method: "GET",
      headers: {
        Accept: "*/*",
        "x-command-center-token": serviceToken,
      },
      cache: "no-store",
    },
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new NextResponse(text || "Failed to fetch attachment", {
      status: upstream.status || 502,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": upstream.headers.get("content-disposition") || "attachment",
      "Content-Length": upstream.headers.get("content-length") || "",
      "Cache-Control": upstream.headers.get("cache-control") || "private, max-age=60",
    },
  });
}
