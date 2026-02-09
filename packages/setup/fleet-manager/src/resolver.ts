import { FleetConfig, DepartmentConfig } from './config.js';
import { Person, Org } from './org.js';

export interface SelectedAgent extends Person {
  resolvedSkills: string[];
  resolvedModel: { primary: string; fallbacks?: string[] };
  resolvedTemplate?: string;
}

export function resolveAgents(config: FleetConfig, org: Org): SelectedAgent[] {
  const selected: SelectedAgent[] = [];
  const byMatrixId = new Map(org.people.map(p => [p.matrixId, p]));

  for (const [deptName, deptConfig] of Object.entries(config.departments)) {
    if (!deptConfig.enabled) continue;

    const deptPeople = org.people.filter(p => p.department === deptName);
    const byLevel = groupByLevel(deptPeople);

    // Select VPs
    const vps = selectFromLevel(byLevel.VP, deptConfig.vp);
    
    // Select Directors (must report to selected VP)
    const vpIds = new Set(vps.map(p => p.matrixId));
    const eligibleDirs = byLevel.Director.filter(p => p.reportsTo && vpIds.has(p.reportsTo));
    const directors = selectFromLevel(eligibleDirs, deptConfig.directors);
    
    // Select Managers (must report to selected Director)
    const dirIds = new Set(directors.map(p => p.matrixId));
    const eligibleMgrs = byLevel.Manager.filter(p => p.reportsTo && dirIds.has(p.reportsTo));
    const managers = selectFromLevel(eligibleMgrs, deptConfig.managers);
    
    // Select ICs (must report to selected Manager)
    const mgrIds = new Set(managers.map(p => p.matrixId));
    const eligibleICs = byLevel.IC.filter(p => p.reportsTo && mgrIds.has(p.reportsTo));
    const ics = selectFromLevel(eligibleICs, deptConfig.ics);

    for (const person of [...vps, ...directors, ...managers, ...ics]) {
      selected.push(resolveAgentConfig(person, config, deptConfig));
    }
  }

  return selected;
}

function groupByLevel(people: Person[]): Record<Person['level'], Person[]> {
  const result: Record<string, Person[]> = { CEO: [], VP: [], Director: [], Manager: [], IC: [] };
  for (const p of people) result[p.level]?.push(p);
  return result as Record<Person['level'], Person[]>;
}

function selectFromLevel(people: Person[], count: number): Person[] {
  return people.sort((a, b) => a.name.localeCompare(b.name)).slice(0, count);
}

function resolveAgentConfig(person: Person, config: FleetConfig, deptConfig: DepartmentConfig): SelectedAgent {
  const override = config.agents?.[person.matrixId];
  return {
    ...person,
    resolvedSkills: override?.skills ?? deptConfig.skills ?? config.defaults.skills,
    resolvedModel: override?.model ?? deptConfig.model ?? config.defaults.model,
    resolvedTemplate: override?.template ?? deptConfig.template,
  };
}
