import { NextRequest, NextResponse } from "next/server";
import { commandCenterBaseUrl, commandCenterServiceToken } from "@/app/api/command-center/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const baseUrl = commandCenterBaseUrl();
  const serviceToken = commandCenterServiceToken();
  const upstreamHeaders: HeadersInit = {
    Accept: "text/event-stream",
  };

  let upstreamUrl = `${baseUrl}/api/events`;
  if (serviceToken) {
    upstreamUrl = `${baseUrl}/api/agent/events`;
    upstreamHeaders["x-command-center-token"] = serviceToken;
  } else {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) {
      return NextResponse.json(
        { error: "Authentication required: missing command-center session cookie or COMMAND_CENTER_API_TOKEN" },
        { status: 401 },
      );
    }
    upstreamHeaders.Cookie = cookieHeader;
  }

  const upstream = await fetch(upstreamUrl, {
    method: "GET",
    headers: upstreamHeaders,
    cache: "no-store",
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => "");
    return new NextResponse(body || "Unable to establish realtime connection", {
      status: upstream.status || 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
