import { NextRequest, NextResponse } from "next/server";
import { actorMatrixIdFromPayload, commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const actorMatrixId = actorMatrixIdFromPayload(payload, "@unknown:anycompany.corp");
  const weekStart = typeof payload.weekStart === "string" ? payload.weekStart : null;

  const serviceToken = commandCenterServiceToken();
  const baseUrl = commandCenterBaseUrl();

  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (serviceToken) {
    headers["x-command-center-token"] = serviceToken;
  } else {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
  }

  const response = await fetch(`${baseUrl}/api/agent/wbr/seed`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      actorMatrixId,
      weekStart,
    }),
    cache: "no-store",
  });

  return relayJsonResponse(response);
}
