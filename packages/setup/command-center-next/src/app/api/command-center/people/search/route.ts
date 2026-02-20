import { NextRequest, NextResponse } from "next/server";
import { commandCenterBaseUrl, commandCenterServiceToken, relayJsonResponse } from "@/app/api/command-center/_utils";

interface DirectorySearchResult {
  name: string;
  title: string;
  department: string;
  matrixId: string;
  raw: string;
}

function parseDirectoryLine(line: string): DirectorySearchResult | null {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length < 4) {
    return null;
  }

  const [name, title, department, matrixId] = parts;
  if (!matrixId.startsWith("@")) {
    return null;
  }

  return { name, title, department, matrixId, raw: line };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limitRaw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "8", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, limitRaw)) : 8;
  const serviceToken = commandCenterServiceToken();

  if (!query) {
    return NextResponse.json({ query, count: 0, results: [] });
  }

  if (!serviceToken) {
    return NextResponse.json({ query, count: 0, results: [], error: "COMMAND_CENTER_API_TOKEN is not configured" }, { status: 500 });
  }

  const response = await fetch(`${commandCenterBaseUrl()}/api/people/query`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-command-center-token": serviceToken,
    },
    body: JSON.stringify({
      action: "search",
      query,
      limit,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return relayJsonResponse(response);
  }

  const payload = (await response.json()) as { results?: unknown };
  const lines = Array.isArray(payload.results) ? payload.results.map((value) => String(value)) : [];
  const results = lines.map(parseDirectoryLine).filter((entry): entry is DirectorySearchResult => entry !== null);

  return NextResponse.json({
    query,
    count: results.length,
    results,
  });
}
