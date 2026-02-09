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

interface Org {
  departments: { name: string; vp: string; teams: string[]; headcount: number }[];
  people: Person[];
}

// Load org.json from workspace (runtime) or fallback to bundled (build time)
function loadOrg(): Org {
  const locations = [
    process.env.ORG_JSON_PATH,
    path.join(process.env.HOME || "/root", ".openclaw/workspace/org.json"),
    path.join(__dirname, "org.json")
  ].filter(Boolean) as string[];
  
  for (const loc of locations) {
    try {
      return JSON.parse(fs.readFileSync(loc, "utf-8"));
    } catch { /* try next */ }
  }
  throw new Error("org.json not found");
}

const org: Org = loadOrg();
const byMatrixId = new Map<string, Person>(org.people.map(p => [p.matrixId, p]));

function formatPerson(p: Person): string {
  return `${p.name} | ${p.title} | ${p.department}${p.team ? '/' + p.team : ''} | ${p.matrixId}`;
}

export function createPeopleTool() {
  return {
    name: "people",
    description: "Search company directory. Find people by name, Matrix ID, department, team, title, or level. Get org chart info like manager, direct reports, reporting chain.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("search"),
        Type.Literal("find"),
        Type.Literal("department"),
        Type.Literal("team"),
        Type.Literal("title"),
        Type.Literal("level"),
        Type.Literal("manager"),
        Type.Literal("reports"),
        Type.Literal("chain"),
        Type.Literal("list")
      ], { description: "Action: search (by name), find (by matrixId), department, team, title, level, manager, reports, chain, list (departments/teams/titles/levels)" }),
      query: Type.Optional(Type.String({ description: "Search query or Matrix ID" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)" }))
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const action = params.action as string;
      const query = (params.query as string || "").toLowerCase();
      const limit = (params.limit as number) || 10;

      let results: string[] = [];

      switch (action) {
        case "search":
          results = org.people
            .filter(p => p.name.toLowerCase().includes(query))
            .slice(0, limit)
            .map(formatPerson);
          break;

        case "find":
          const person = byMatrixId.get(params.query as string);
          if (person) results = [formatPerson(person)];
          break;

        case "department":
          results = org.people
            .filter(p => p.department.toLowerCase() === query)
            .slice(0, limit)
            .map(formatPerson);
          break;

        case "team":
          results = org.people
            .filter(p => p.team?.toLowerCase() === query)
            .slice(0, limit)
            .map(formatPerson);
          break;

        case "title":
          results = org.people
            .filter(p => p.title.toLowerCase().includes(query))
            .slice(0, limit)
            .map(formatPerson);
          break;

        case "level":
          results = org.people
            .filter(p => p.level.toLowerCase() === query)
            .slice(0, limit)
            .map(formatPerson);
          break;

        case "manager": {
          const emp = byMatrixId.get(params.query as string);
          if (emp?.reportsTo) {
            const mgr = byMatrixId.get(emp.reportsTo);
            if (mgr) results = [formatPerson(mgr)];
          }
          break;
        }

        case "reports": {
          const emp = byMatrixId.get(params.query as string);
          if (emp) {
            results = emp.directReports
              .map(id => byMatrixId.get(id))
              .filter(Boolean)
              .slice(0, limit)
              .map(p => formatPerson(p!));
          }
          break;
        }

        case "chain": {
          const emp = byMatrixId.get(params.query as string);
          if (emp) {
            const chain: Person[] = [];
            let current = emp.reportsTo ? byMatrixId.get(emp.reportsTo) : undefined;
            while (current) {
              chain.push(current);
              current = current.reportsTo ? byMatrixId.get(current.reportsTo) : undefined;
            }
            results = chain.map(formatPerson);
          }
          break;
        }

        case "list":
          if (query === "departments") {
            results = org.departments.map(d => `${d.name} (${d.headcount} people)`);
          } else if (query === "teams") {
            results = [...new Set(org.people.map(p => p.team).filter(Boolean) as string[])].sort();
          } else if (query === "titles") {
            results = [...new Set(org.people.map(p => p.title))].sort().slice(0, limit);
          } else if (query === "levels") {
            results = ["VP", "Director", "Manager", "IC"];
          }
          break;
      }

      return {
        content: [{ 
          type: "text", 
          text: results.length ? results.join("\n") : "No results found"
        }]
      };
    }
  };
}
