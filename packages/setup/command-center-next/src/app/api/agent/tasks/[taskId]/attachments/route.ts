import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function parseActorFromUnknown(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return commandCenterBackend.parseActorMatrixId(value);
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

  try {
    const attachments = await commandCenterBackend.listTaskAttachments(trimmedTaskId);
    return NextResponse.json({ taskId: trimmedTaskId, count: attachments.length, attachments }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list attachments";
    const status = message === "Task not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
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

  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const actorMatrixId = parseActorFromUnknown(form.get("actorMatrixId"));
      if (!actorMatrixId) {
        return NextResponse.json({ error: "actorMatrixId is required" }, { status: 400 });
      }

      const linkPathRaw = form.get("linkPath");
      if (typeof linkPathRaw === "string" && linkPathRaw.trim().length > 0) {
        const task = await commandCenterBackend.addTaskAttachmentLink(
          trimmedTaskId,
          {
            sharedPath: linkPathRaw,
            fileName: typeof form.get("fileName") === "string" ? String(form.get("fileName")) : undefined,
            contentType: typeof form.get("contentType") === "string" ? String(form.get("contentType")) : null,
          },
          actorMatrixId,
        );
        return NextResponse.json(task, { status: 201 });
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file or linkPath is required" }, { status: 400 });
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const task = await commandCenterBackend.addTaskAttachmentUpload(
        trimmedTaskId,
        {
          fileName: file.name || "attachment",
          contentType: file.type || null,
          data: bytes,
        },
        actorMatrixId,
      );
      return NextResponse.json(task, { status: 201 });
    }

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const actorMatrixId = parseActorFromUnknown(payload.actorMatrixId);
    if (!actorMatrixId) {
      return NextResponse.json({ error: "actorMatrixId is required" }, { status: 400 });
    }

    if (typeof payload.linkPath !== "string" || !payload.linkPath.trim()) {
      return NextResponse.json({ error: "linkPath is required for JSON requests" }, { status: 400 });
    }

    const task = await commandCenterBackend.addTaskAttachmentLink(
      trimmedTaskId,
      {
        sharedPath: payload.linkPath,
        fileName: typeof payload.fileName === "string" ? payload.fileName : undefined,
        contentType: typeof payload.contentType === "string" ? payload.contentType : null,
      },
      actorMatrixId,
    );
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add attachment";
    const status =
      message === "Task not found"
        ? 404
        : message.includes("required") || message.includes("size") || message.includes("sharedPath")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
