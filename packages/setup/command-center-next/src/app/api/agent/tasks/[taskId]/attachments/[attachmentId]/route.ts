import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string; attachmentId: string }>;
}

function toContentDispositionFileName(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `filename="${safe}"`;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const { taskId, attachmentId } = await context.params;
  const trimmedTaskId = taskId.trim();
  const trimmedAttachmentId = attachmentId.trim();
  if (!trimmedTaskId || !trimmedAttachmentId) {
    return NextResponse.json({ error: "taskId and attachmentId are required" }, { status: 400 });
  }

  const inline = (request.nextUrl.searchParams.get("inline") || "").toLowerCase();
  const inlineMode = inline === "1" || inline === "true" || inline === "yes";

  try {
    const payload = await commandCenterBackend.getTaskAttachmentContent(trimmedTaskId, trimmedAttachmentId);
    const bytes = Uint8Array.from(payload.data);
    const body = new Blob([bytes], {
      type: payload.attachment.contentType || "application/octet-stream",
    });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": payload.attachment.contentType || "application/octet-stream",
        "Content-Length": String(payload.attachment.sizeBytes),
        "Content-Disposition": `${inlineMode ? "inline" : "attachment"}; ${toContentDispositionFileName(payload.attachment.fileName)}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch attachment";
    const status = message === "Task not found" || message === "Attachment not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
