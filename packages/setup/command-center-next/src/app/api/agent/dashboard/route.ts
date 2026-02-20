import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const payload = await commandCenterBackend.getDashboard();
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
