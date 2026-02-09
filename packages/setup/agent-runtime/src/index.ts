import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import http from 'http';
import crypto from 'crypto';

const HOMESERVER = process.env.MATRIX_HOMESERVER || 'http://conduit:6167';
const AGENT_MATRIX_ID = process.env.AGENT_MATRIX_ID!;
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '/workspace';
const FLEET_SECRET_ARN = process.env.FLEET_SECRET_ARN;
const FLEET_SECRET = process.env.FLEET_SECRET; // From ECS secrets

// Derive password from fleet secret (same logic as fleet-manager)
function derivePassword(matrixId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(matrixId).digest('hex').slice(0, 32);
}

async function getFleetSecret(): Promise<string> {
  if (FLEET_SECRET) {
    console.log(`Using FLEET_SECRET from environment (length: ${FLEET_SECRET.length}, starts with: ${FLEET_SECRET.slice(0, 4)}...)`);
    return FLEET_SECRET;
  }
  
  // Fallback: fetch from Secrets Manager if ARN provided
  if (FLEET_SECRET_ARN) {
    // This would require AWS SDK - for now just error
    throw new Error('FLEET_SECRET not available, only ARN provided');
  }
  
  throw new Error('FLEET_SECRET or FLEET_SECRET_ARN required');
}

async function request(method: string, path: string, body?: object, token?: string): Promise<any> {
  const url = new URL(path, HOMESERVER);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForHomeserver(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await request('GET', '/_matrix/client/versions');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Homeserver not available');
}

async function getToken(): Promise<string> {
  const username = AGENT_MATRIX_ID.split(':')[0].slice(1);
  const fleetSecret = await getFleetSecret();
  const password = derivePassword(AGENT_MATRIX_ID, fleetSecret);
  
  console.log(`Attempting login for ${username} (matrix ID: ${AGENT_MATRIX_ID})`);
  console.log(`Derived password: ${password.slice(0, 8)}...`);

  // Try to register (will fail if user exists, but that's ok)
  try {
    const regResponse = await request('POST', '/_matrix/client/r0/register', {
      username,
      password,
      auth: { type: 'm.login.dummy' },
    });
    console.log('Registered successfully');
    if (regResponse.access_token) {
      return regResponse.access_token;
    }
    // Wait a bit for Conduit to process
    await new Promise(r => setTimeout(r, 1000));
  } catch (e: any) {
    console.log(`Registration failed: ${e.errcode || 'error'} - ${e.error || ''}`);
  }

  // Login
  const response = await request('POST', '/_matrix/client/r0/login', {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
  });

  if (!response.access_token) {
    console.error('Login failed:', JSON.stringify(response));
    throw new Error('No access_token in login response');
  }

  return response.access_token;
}

async function main(): Promise<void> {
  const configPath = `${WORKSPACE_PATH}/openclaw.json`;
  if (!existsSync(configPath)) {
    console.error(`${configPath} not found`);
    process.exit(1);
  }

  await waitForHomeserver();
  const token = await getToken();
  console.log(`Logged in as ${AGENT_MATRIX_ID}`);

  // Create/join rooms - org.json is in parent workspaces folder
  const orgPaths = [`${WORKSPACE_PATH}/org.json`, `${WORKSPACE_PATH}/../org.json`];
  for (const orgPath of orgPaths) {
    if (existsSync(orgPath)) {
      const org = JSON.parse(readFileSync(orgPath, 'utf-8'));
      await setupRooms(token, org);
      break;
    }
  }

  // Read config, inject token and workspace path, write to openclaw dir
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  config.channels.matrix.accessToken = token;
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.workspace = WORKSPACE_PATH;
  console.log(`Injected accessToken: ${token.slice(0, 20)}...`);
  
  // Add gateway token
  const gatewayToken = crypto.randomUUID();
  config.gateway = config.gateway || {};
  config.gateway.auth = { token: gatewayToken };

  // Set browser executable path for headless container
  config.browser = config.browser || {};
  config.browser.executablePath = '/usr/bin/chromium';
  config.browser.headless = true;

  mkdirSync('/root/.openclaw', { recursive: true });
  writeFileSync('/root/.openclaw/openclaw.json', JSON.stringify(config, null, 2));
  console.log('Wrote config to /root/.openclaw/openclaw.json');

  // Copy workspace files to OpenClaw's expected location
  mkdirSync('/root/.openclaw/workspace', { recursive: true });
  const files = ['IDENTITY.md', 'AGENTS.md', 'SOUL.md', 'PROTOCOL.md', 'HEARTBEAT.md', 'TOOLS.md', 'USER.md', 'org.json'];
  for (const file of files) {
    const sourcePath = `${WORKSPACE_PATH}/${file}`;
    if (existsSync(sourcePath)) {
      writeFileSync(`/root/.openclaw/workspace/${file}`, readFileSync(sourcePath));
    }
  }
  console.log('Copied workspace files');

  console.log('Starting OpenClaw...');
  const oc = spawn('openclaw', ['gateway', '--token', gatewayToken], {
    stdio: 'inherit',
    env: { ...process.env, OPENCLAW_WORKSPACE: WORKSPACE_PATH },
  });
  oc.on('exit', (code) => process.exit(code || 0));
}

async function setupRooms(token: string, org: { people: any[] }): Promise<void> {
  const domain = AGENT_MATRIX_ID.split(':')[1];
  const me = org.people.find((p: any) => p.matrixId === AGENT_MATRIX_ID);
  if (!me) {
    console.log('Agent not found in org');
    return;
  }

  console.log(`Joining rooms as ${me.level} in ${me.department}`);

  // Join all-employees
  await joinRoom(token, 'all-employees', domain);

  // Join department leadership if VP or Director
  if (me.level === 'VP' || me.level === 'Director') {
    await joinRoom(token, `${me.department.toLowerCase()}-leadership`, domain);
  }

  // Join team room if has team
  if (me.team) {
    await joinRoom(token, `${me.team.toLowerCase().replace(/\s+/g, '-')}-team`, domain);
  }
}

async function joinRoom(token: string, alias: string, domain: string): Promise<void> {
  try {
    await request('POST', `/_matrix/client/r0/join/${encodeURIComponent(`#${alias}:${domain}`)}`, {}, token);
    console.log(`Joined #${alias}`);
  } catch (e) {
    console.log(`Failed to join #${alias}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
