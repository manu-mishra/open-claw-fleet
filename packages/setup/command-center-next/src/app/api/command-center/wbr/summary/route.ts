import { NextRequest, NextResponse } from "next/server";
import { commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const serviceToken = commandCenterServiceToken();
  const baseUrl = commandCenterBaseUrl();
  const weekStart = request.nextUrl.searchParams.get("weekStart");
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : "";

  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (serviceToken) {
    headers["x-command-center-token"] = serviceToken;
  } else {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
  }

  const response = await fetch(`${baseUrl}/api/agent/wbr/summary${query}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  return relayJsonResponse(response);
}
