import { NextRequest, NextResponse } from "next/server";
import { commandCenterBackend, isServiceAuthAuthorized, serviceAuthErrorBody } from "@/lib/command-center/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isServiceAuthAuthorized(request.headers)) {
    return NextResponse.json(serviceAuthErrorBody(), { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = commandCenterBackend.parsePeopleAction(payload.action);
  if (!action) {
    return NextResponse.json(
      { error: "action is required. Supported actions: search, find, department, team, title, level, manager, reports, chain, list" },
      { status: 400 },
    );
  }

  const query = String(payload.query ?? "");
  const limit = commandCenterBackend.parsePeopleLimit(payload.limit);
  const results = await commandCenterBackend.queryPeople(action, query, limit);

  return NextResponse.json(
    {
      action,
      query,
      limit,
      count: results.length,
      results,
    },
    { status: 200 },
  );
}
