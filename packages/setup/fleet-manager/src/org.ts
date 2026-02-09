// Org generator - creates 1001 person organization
// Moved from poc/matrix-agents/directory/generate-org.js

export interface Person {
  name: string;
  title: string;
  level: 'CEO' | 'VP' | 'Director' | 'Manager' | 'IC';
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

export interface Org {
  departments: Department[];
  people: Person[];
}

const firstNames = [
  "Olivia","Emma","Charlotte","Amelia","Sophia","Isabella","Ava","Mia","Evelyn","Luna",
  "Harper","Camila","Sofia","Scarlett","Elizabeth","Eleanor","Emily","Chloe","Mila","Violet",
  "Penelope","Gianna","Aria","Abigail","Ella","Avery","Hazel","Nora","Layla","Lily",
  "Aurora","Nova","Ellie","Madison","Grace","Isla","Willow","Zoe","Riley","Stella",
  "Liam","Noah","Oliver","James","Elijah","William","Henry","Lucas","Benjamin","Theodore",
  "Jack","Levi","Alexander","Jackson","Mateo","Daniel","Michael","Mason","Sebastian","Ethan",
  "Logan","Owen","Samuel","Jacob","Asher","Aiden","John","Joseph","Wyatt","David",
  "Leo","Luke","Julian","Hudson","Grayson","Matthew","Ezra","Gabriel","Carter","Isaac",
  "Jayden","Luca","Anthony","Dylan","Lincoln","Thomas","Maverick","Elias","Josiah","Charles",
  "Caleb","Christopher","Ezekiel","Miles","Jaxon","Isaiah","Andrew","Joshua","Nathan","Nolan",
  "Adrian","Cameron","Santiago","Eli","Aaron","Ryan","Angel","Cooper","Waylon","Easton",
  "Kai","Christian","Landon","Colton","Roman","Axel","Brooks","Jonathan","Robert","Jameson",
  "Ian","Everett","Greyson","Wesley","Jeremiah","Hunter","Leonardo","Jordan","Jose","Bennett",
  "Silas","Nicholas","Parker","Beau","Weston","Austin","Connor","Carson","Dominic","Xavier",
  "Braxton","Ashton","Rhett","Atlas","Jude","Bentley","Carlos","Ryker","Timothy","Finn",
  "Nicole","Serenity","Jade","Skylar","Madeline","Julia","Clara","Melody","Lydia","Eva",
  "Rose","Ariana","Gabriella","Sarah","Samantha","Allison","Maria","Taylor","Jasmine","Iris",
  "Oakley","Magnolia","Teagan","Aspen","Reese","Noelle","Hayden","Palmer","Kaia","Rowan"
];

const lastNames = [
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
  "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
  "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
  "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
  "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
  "Gomez","Phillips","Evans","Turner","Diaz","Parker","Cruz","Edwards","Collins","Reyes",
  "Stewart","Morris","Murphy","Cook","Rogers","Morgan","Cooper","Peterson","Bailey","Reed",
  "Kelly","Howard","Kim","Cox","Ward","Richardson","Watson","Brooks","Wood","James",
  "Bennett","Gray","Hughes","Price","Sanders","Patel","Myers","Long","Ross","Foster",
  "Powell","Jenkins","Perry","Russell","Sullivan","Bell","Coleman","Butler","Henderson","Barnes"
];

const departments = [
  { name: "Engineering", size: 350, teams: ["Platform","Frontend","Backend","Infrastructure","QA"] },
  { name: "Sales", size: 200, teams: ["Enterprise","Mid-Market","SMB","Partnerships"] },
  { name: "Marketing", size: 100, teams: ["Brand","Demand Gen","Content","Events"] },
  { name: "Product", size: 80, teams: ["Core Product","Growth","Platform"] },
  { name: "Operations", size: 80, teams: ["IT","Facilities","Security"] },
  { name: "Customer Success", size: 70, teams: ["Enterprise CS","Support","Onboarding"] },
  { name: "Finance", size: 50, teams: ["Accounting","FP&A"] },
  { name: "People", size: 40, teams: ["Recruiting","People Ops"] },
  { name: "Legal", size: 30, teams: ["Corporate","Compliance"] }
];

const icTitles: Record<string, string[]> = {
  "Engineering": ["Software Engineer","Senior Software Engineer","Staff Engineer","Principal Engineer","SRE"],
  "Sales": ["Account Executive","Senior AE","Sales Development Rep","Solutions Engineer"],
  "Marketing": ["Marketing Manager","Marketing Specialist","Content Writer","Graphic Designer"],
  "Product": ["Product Manager","Senior PM","UX Designer","UX Researcher","Product Analyst"],
  "Operations": ["Operations Analyst","IT Specialist","Security Analyst","Systems Admin"],
  "Customer Success": ["Customer Success Manager","Support Engineer","Technical Account Manager"],
  "Finance": ["Financial Analyst","Senior Accountant","Accountant","Treasury Analyst"],
  "People": ["Recruiter","Senior Recruiter","HR Business Partner","People Ops Specialist"],
  "Legal": ["Paralegal","Contract Specialist","Compliance Analyst","Legal Counsel"]
};

export function generateOrg(domain: string, seed?: number, ceo?: { name: string; matrixId: string }): Org {
  const rng = seededRandom(seed ?? Date.now());
  const usedNames = new Set<string>();
  const people: Person[] = [];
  const deptIndex: Department[] = [];

  // Add CEO first if provided
  if (ceo) {
    usedNames.add(ceo.name);
    people.push({
      name: ceo.name,
      title: 'CEO',
      level: 'CEO',
      department: 'Executive',
      team: null,
      matrixId: ceo.matrixId,
      reportsTo: null,
      directReports: [] // Will be populated with VPs
    });
  }

  function genName(): string {
    for (let i = 0; i < 1000; i++) {
      const f = firstNames[Math.floor(rng() * firstNames.length)];
      const l = lastNames[Math.floor(rng() * lastNames.length)];
      const full = `${f} ${l}`;
      if (!usedNames.has(full)) {
        usedNames.add(full);
        return full;
      }
    }
    const f = firstNames[Math.floor(rng() * firstNames.length)];
    const m = String.fromCharCode(65 + Math.floor(rng() * 26));
    const l = lastNames[Math.floor(rng() * lastNames.length)];
    return `${f} ${m}. ${l}`;
  }

  function toMatrixId(name: string): string {
    return "@" + name.toLowerCase().replace(/[. ]+/g, ".").replace(/\.\./g, ".") + ":" + domain;
  }

  function makePerson(level: Person['level'], dept: string, team: string | null, title: string, reportsTo: string | null): Person {
    const name = genName();
    return { name, title, level, department: dept, team, matrixId: toMatrixId(name), reportsTo, directReports: [] };
  }

  const ceoEntry = ceo ? people[0] : null;

  for (const dept of departments) {
    const vp = makePerson("VP", dept.name, null, `VP of ${dept.name}`, ceoEntry?.matrixId ?? null);
    if (ceoEntry) ceoEntry.directReports.push(vp.matrixId);
    people.push(vp);

    const directors: Person[] = [];
    for (const team of dept.teams) {
      const dir = makePerson("Director", dept.name, team, `Director of ${team}`, vp.matrixId);
      vp.directReports.push(dir.matrixId);
      people.push(dir);
      directors.push(dir);
    }

    const remaining = dept.size - 1 - directors.length;
    const managersTotal = Math.floor(remaining / 6);
    let icsLeft = remaining - managersTotal;
    let managersLeft = managersTotal;
    const managersPerDir = Math.ceil(managersTotal / directors.length);

    for (const dir of directors) {
      const mgrCount = Math.min(managersPerDir, managersLeft);
      managersLeft -= mgrCount;
      
      for (let m = 0; m < mgrCount; m++) {
        const mgr = makePerson("Manager", dept.name, dir.team, `${dir.team} Manager`, dir.matrixId);
        dir.directReports.push(mgr.matrixId);
        people.push(mgr);

        const icCount = Math.min(5, icsLeft);
        icsLeft -= icCount;
        const titles = icTitles[dept.name] || ["Specialist"];
        for (let i = 0; i < icCount; i++) {
          const ic = makePerson("IC", dept.name, dir.team, titles[Math.floor(rng() * titles.length)], mgr.matrixId);
          mgr.directReports.push(ic.matrixId);
          people.push(ic);
        }
      }
    }

    if (icsLeft > 0) {
      const lastMgr = people.filter(p => p.level === "Manager" && p.department === dept.name).pop();
      if (lastMgr) {
        const titles = icTitles[dept.name] || ["Specialist"];
        for (let i = 0; i < icsLeft; i++) {
          const ic = makePerson("IC", dept.name, lastMgr.team, titles[Math.floor(rng() * titles.length)], lastMgr.matrixId);
          lastMgr.directReports.push(ic.matrixId);
          people.push(ic);
        }
      }
    }

    deptIndex.push({ name: dept.name, vp: vp.matrixId, teams: dept.teams, headcount: dept.size });
  }

  return { departments: deptIndex, people };
}

// Simple seeded PRNG for reproducible orgs
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
