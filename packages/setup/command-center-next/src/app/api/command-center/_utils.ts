import { NextResponse } from "next/server";

function parseJson(payload: string): unknown {
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(payload);
  } catch {
    return { error: payload };
  }
}

export function commandCenterBaseUrl(): string {
  return (
    process.env.COMMAND_CENTER_API_BASE_URL ??
    process.env.NEXT_PUBLIC_COMMAND_CENTER_API_BASE_URL ??
    "http://localhost:8090"
  ).replace(/\/+$/, "");
}

export function commandCenterServiceToken(): string {
  return (process.env.COMMAND_CENTER_API_TOKEN ?? process.env.FLEET_SECRET ?? "").trim();
}

export async function relayJsonResponse(response: Response): Promise<NextResponse> {
  const bodyText = await response.text();
  return NextResponse.json(parseJson(bodyText), { status: response.status });
}

export function actorMatrixIdFromPayload(payload: unknown, fallback: string): string {
  const candidate = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).actorMatrixId : null;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return fallback;
}
