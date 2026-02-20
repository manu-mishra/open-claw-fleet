import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  return commandCenterBackend.createSseResponse(request.signal);
}
