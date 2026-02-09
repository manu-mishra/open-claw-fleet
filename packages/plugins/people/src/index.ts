import * as path from "path";
import * as fs from "fs";
import { createPeopleTool } from "./people-tool";

// Types
export interface Person {
  name: string;
  title: string;
  level: "CEO" | "VP" | "Director" | "Manager" | "IC";
  department: string;
  team: string | null;
  matrixId: string;
  reportsTo: string | null;
  directReports: string[];
}

export interface Department {
  name: string;
  vp: string;
  teams: string[];
  headcount: number;
}

interface Org {
  departments: Department[];
  people: Person[];
}

// Load org data - looks for org.json in workspaces dir or falls back to bundled
function loadOrg(): Org {
  const locations = [
    process.env.ORG_JSON_PATH,
    path.join(process.cwd(), "workspaces", "org.json"),
    path.join(__dirname, "org.json")
  ].filter(Boolean) as string[];

  for (const loc of locations) {
    try {
      return JSON.parse(fs.readFileSync(loc, "utf-8"));
    } catch { /* try next */ }
  }
  throw new Error("org.json not found. Run 'bootstrap generate' first or set ORG_JSON_PATH");
}

const org: Org = loadOrg();
const byMatrixId = new Map<string, Person>(org.people.map(p => [p.matrixId, p]));

// Lookup functions
export function find(matrixId: string): Person | undefined {
  return byMatrixId.get(matrixId);
}

export function searchByName(query: string): Person[] {
  const q = query.toLowerCase();
  return org.people.filter(p => p.name.toLowerCase().includes(q));
}

export function getByDepartment(dept: string): Person[] {
  return org.people.filter(p => p.department.toLowerCase() === dept.toLowerCase());
}

export function getByTeam(team: string): Person[] {
  return org.people.filter(p => p.team?.toLowerCase() === team.toLowerCase());
}

export function getByLevel(level: Person["level"]): Person[] {
  return org.people.filter(p => p.level === level);
}

export function searchByTitle(query: string): Person[] {
  const q = query.toLowerCase();
  return org.people.filter(p => p.title.toLowerCase().includes(q));
}

export function getManager(person: Person): Person | undefined {
  return person.reportsTo ? byMatrixId.get(person.reportsTo) : undefined;
}

export function getDirectReports(person: Person): Person[] {
  return person.directReports.map(id => byMatrixId.get(id)!).filter(Boolean);
}

export function getReportingChain(person: Person): Person[] {
  const chain: Person[] = [];
  let current = getManager(person);
  while (current) {
    chain.push(current);
    current = getManager(current);
  }
  return chain;
}

export function getAllReports(person: Person): Person[] {
  const all: Person[] = [];
  const queue = [...person.directReports];
  while (queue.length) {
    const id = queue.shift()!;
    const p = byMatrixId.get(id);
    if (p) {
      all.push(p);
      queue.push(...p.directReports);
    }
  }
  return all;
}

export function getDepartment(name: string): Department | undefined {
  return org.departments.find(d => d.name.toLowerCase() === name.toLowerCase());
}

export function listDepartments(): Department[] {
  return org.departments;
}

export function listTitles(): string[] {
  return [...new Set(org.people.map(p => p.title))].sort();
}

export function listLevels(): Person["level"][] {
  return ["CEO", "VP", "Director", "Manager", "IC"];
}

export function listTeams(): string[] {
  return [...new Set(org.people.map(p => p.team).filter(Boolean) as string[])].sort();
}

// OpenClaw plugin registration
export default function register(api: any) {
  api.registerTool(createPeopleTool());
}
