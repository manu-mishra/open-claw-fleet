import { Type } from "@sinclair/typebox";
import * as path from "path";
import * as fs from "fs";

interface Person {
  name: string;
  title: string;
  level: string;
  department: string;
  team: string | null;
  matrixId: string;
  reportsTo: string | null;
  directReports: string[];
}

interface Department {
  name: string;
  vp: string;
  teams: string[];
  headcount: number;
}

interface Org {
  departments: Department[];
  people: Person[];
}

type PeopleAction =
  | "search"
  | "find"
  | "department"
  | "team"
  | "title"
  | "level"
  | "manager"
  | "reports"
  | "chain"
  | "list";

const COMMAND_CENTER_URL = (process.env.COMMAND_CENTER_URL || "http://command-center:8090").replace(/\/+$/, "");
const COMMAND_CENTER_API_TOKEN = process.env.COMMAND_CENTER_API_TOKEN || "";
const COMMAND_CENTER_TIMEOUT_MS = Number.parseInt(process.env.COMMAND_CENTER_TIMEOUT_MS || "5000", 10);
const MATRIX_DOMAIN = process.env.MATRIX_DOMAIN || "anycompany.corp";
const PEOPLE_TOOL_ALLOW_FILE_FALLBACK = ["1", "true", "yes"].includes(
  String(process.env.PEOPLE_TOOL_ALLOW_FILE_FALLBACK || "false").toLowerCase(),
);
const MAX_LIMIT = 100;

let cachedOrg: Org | null = null;

function normalizeMatrixId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("@") && trimmed.includes(":")) return trimmed;
  if (trimmed.startsWith("@")) return `${trimmed}:${MATRIX_DOMAIN}`;
  if (trimmed.includes(":")) return `@${trimmed}`;
  return `@${trimmed}:${MATRIX_DOMAIN}`;
}

function loadOrgFromFile(): Org {
  if (cachedOrg) return cachedOrg;

  const locations = [
    process.env.ORG_JSON_PATH,
    path.join(process.cwd(), "org.json"),
    path.join(process.env.HOME || "/root", ".openclaw/workspace/org.json"),
    path.join(__dirname, "org.json"),
  ].filter(Boolean) as string[];

  for (const location of locations) {
    try {
      const parsed = JSON.parse(fs.readFileSync(location, "utf-8")) as Org;
      cachedOrg = parsed;
      return parsed;
    } catch {
      // Try next location.
    }
  }

  throw new Error("people tool: org.json not found and Command Center was unreachable");
}

function formatPerson(person: Person): string {
  return `${person.name} | ${person.title} | ${person.department}${person.team ? "/" + person.team : ""} | ${person.matrixId}`;
}

function queryFromOrg(org: Org, action: PeopleAction, queryRaw: string, limitRaw: number): string[] {
  const query = queryRaw.trim();
  const normalizedQuery = query.toLowerCase();
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitRaw || 10)));
  const byMatrixId = new Map(org.people.map((person) => [normalizeMatrixId(person.matrixId), person]));

  switch (action) {
    case "search":
      return org.people
        .filter((person) => {
          if (!normalizedQuery) {
            return true;
          }
          return (
            person.name.toLowerCase().includes(normalizedQuery)
            || person.title.toLowerCase().includes(normalizedQuery)
            || person.department.toLowerCase().includes(normalizedQuery)
            || (person.team?.toLowerCase().includes(normalizedQuery) ?? false)
            || person.matrixId.toLowerCase().includes(normalizedQuery)
          );
        })
        .slice(0, limit)
        .map(formatPerson);
    case "find": {
      const person = byMatrixId.get(normalizeMatrixId(query));
      return person ? [formatPerson(person)] : [];
    }
    case "department":
      return org.people
        .filter((person) => person.department.toLowerCase() === normalizedQuery)
        .slice(0, limit)
        .map(formatPerson);
    case "team":
      return org.people
        .filter((person) => person.team?.toLowerCase() === normalizedQuery)
        .slice(0, limit)
        .map(formatPerson);
    case "title":
      return org.people
        .filter((person) => person.title.toLowerCase().includes(normalizedQuery))
        .slice(0, limit)
        .map(formatPerson);
    case "level":
      return org.people
        .filter((person) => person.level.toLowerCase() === normalizedQuery)
        .slice(0, limit)
        .map(formatPerson);
    case "manager": {
      const person = byMatrixId.get(normalizeMatrixId(query));
      if (!person?.reportsTo) return [];
      const manager = byMatrixId.get(normalizeMatrixId(person.reportsTo));
      return manager ? [formatPerson(manager)] : [];
    }
    case "reports": {
      const person = byMatrixId.get(normalizeMatrixId(query));
      if (!person) return [];
      return person.directReports
        .map((matrixId) => byMatrixId.get(normalizeMatrixId(matrixId)))
        .filter((entry): entry is Person => Boolean(entry))
        .slice(0, limit)
        .map(formatPerson);
    }
    case "chain": {
      const person = byMatrixId.get(normalizeMatrixId(query));
      if (!person) return [];

      const chain: Person[] = [];
      const visited = new Set<string>();
      let current = person.reportsTo ? byMatrixId.get(normalizeMatrixId(person.reportsTo)) : undefined;
      while (current && !visited.has(current.matrixId)) {
        visited.add(current.matrixId);
        chain.push(current);
        current = current.reportsTo ? byMatrixId.get(normalizeMatrixId(current.reportsTo)) : undefined;
      }
      return chain.map(formatPerson);
    }
    case "list":
      if (normalizedQuery === "departments") {
        return org.departments.map((department) => `${department.name} (${department.headcount} people)`);
      }
      if (normalizedQuery === "teams") {
        return [...new Set(org.people.map((person) => person.team).filter(Boolean) as string[])].sort();
      }
      if (normalizedQuery === "titles") {
        return [...new Set(org.people.map((person) => person.title))].sort().slice(0, limit);
      }
      if (normalizedQuery === "levels") {
        return [...new Set(org.people.map((person) => person.level))].sort().slice(0, limit);
      }
      return [];
    default:
      return [];
  }
}

async function queryCommandCenter(action: PeopleAction, query: string, limit: number): Promise<string[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(COMMAND_CENTER_TIMEOUT_MS) ? COMMAND_CENTER_TIMEOUT_MS : 5000);

  try {
    const response = await fetch(`${COMMAND_CENTER_URL}/api/people/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(COMMAND_CENTER_API_TOKEN ? { "x-command-center-token": COMMAND_CENTER_API_TOKEN } : {}),
      },
      body: JSON.stringify({ action, query, limit }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as { results?: unknown };
    if (!Array.isArray(payload.results)) {
      return null;
    }

    return payload.results.map((entry) => String(entry));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createPeopleTool() {
  return {
    name: "people",
    description:
      "Search company directory via Command Center People API. Optional local org.json fallback if PEOPLE_TOOL_ALLOW_FILE_FALLBACK=true.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("search"),
          Type.Literal("find"),
          Type.Literal("department"),
          Type.Literal("team"),
          Type.Literal("title"),
          Type.Literal("level"),
          Type.Literal("manager"),
          Type.Literal("reports"),
          Type.Literal("chain"),
          Type.Literal("list"),
        ],
        {
          description:
            "Action: search (by name), find (by matrixId), department, team, title, level, manager, reports, chain, list (departments/teams/titles/levels)",
        },
      ),
      query: Type.Optional(Type.String({ description: "Search query or Matrix ID" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10, max 100)" })),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const action = params.action as PeopleAction;
      const query = String(params.query ?? "");
      const limit = typeof params.limit === "number" ? params.limit : 10;

      const serviceResults = await queryCommandCenter(action, query, limit);
      if (serviceResults === null) {
        if (!PEOPLE_TOOL_ALLOW_FILE_FALLBACK) {
          throw new Error(
            "People API unavailable from Command Center. Set PEOPLE_TOOL_ALLOW_FILE_FALLBACK=true to allow local org.json fallback.",
          );
        }
      }

      const results = serviceResults ?? queryFromOrg(loadOrgFromFile(), action, query, limit);

      return {
        content: [
          {
            type: "text",
            text: results.length ? results.join("\n") : "No results found",
          },
        ],
      };
    },
  };
}
