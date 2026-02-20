#!/usr/bin/env node
import { spawn } from 'child_process';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { ECSClient, ListServicesCommand, ListTasksCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';

const REGION = 'us-east-1';
const CLUSTER = 'open-claw-fleet-dev';

const ec2 = new EC2Client({ region: REGION });
const ecs = new ECSClient({ region: REGION });

async function getBastionId(): Promise<string> {
  const response = await ec2.send(new DescribeInstancesCommand({
    Filters: [
      { Name: 'tag:Name', Values: ['*Bastion*'] },
      { Name: 'instance-state-name', Values: ['running'] }
    ]
  }));
  return response.Reservations?.[0]?.Instances?.[0]?.InstanceId || '';
}

async function getTaskIp(serviceName: string): Promise<string> {
  // Get service ARN
  const services = await ecs.send(new ListServicesCommand({ cluster: CLUSTER }));
  const serviceArn = services.serviceArns?.find(arn => arn.includes(serviceName));
  
  if (!serviceArn) throw new Error(`Service ${serviceName} not found`);

  // Get task ARN
  const tasks = await ecs.send(new ListTasksCommand({ 
    cluster: CLUSTER, 
    serviceName: serviceArn 
  }));
  const taskArn = tasks.taskArns?.[0];
  
  if (!taskArn) throw new Error(`No tasks running for ${serviceName}`);

  // Get task IP
  const taskDetails = await ecs.send(new DescribeTasksCommand({
    cluster: CLUSTER,
    tasks: [taskArn]
  }));

  const attachment = taskDetails.tasks?.[0]?.attachments?.[0];
  const ipDetail = attachment?.details?.find(d => d.name === 'privateIPv4Address');
  const containerIp = taskDetails.tasks?.[0]?.containers?.[0]?.networkInterfaces?.[0]?.privateIpv4Address;
  
  return containerIp || ipDetail?.value || '';
}

async function startPortForward(bastionId: string, targetIp: string, port: number, name: string) {
  console.log(`🔗 Forwarding ${name}: localhost:${port} → ${targetIp}:${port}`);
  
  const proc = spawn('aws', [
    'ssm', 'start-session',
    '--target', bastionId,
    '--region', REGION,
    '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
    '--parameters', JSON.stringify({
      host: [targetIp],
      portNumber: [port.toString()],
      localPortNumber: [port.toString()]
    })
  ], { stdio: 'inherit' });

  return proc;
}

async function main() {
  console.log('🦞 Open-Claw-Fleet Connection Tool\n');

  try {
    console.log('📡 Getting service information...');
    const bastionId = await getBastionId();
    const conduitIp = await getTaskIp('Conduit');
    const elementIp = await getTaskIp('Element');
    let commandCenterIp: string | null = null;
    try {
      commandCenterIp = await getTaskIp('CommandCenter');
    } catch {
      commandCenterIp = null;
    }

    console.log(`\n✅ Found services:`);
    console.log(`   Bastion: ${bastionId}`);
    console.log(`   Conduit: ${conduitIp}`);
    console.log(`   Element: ${elementIp}`);
    console.log(`   Command Center: ${commandCenterIp ?? 'not found'}\n`);

    console.log('🚀 Starting port forwards...\n');

    // Start all port forwards
    const conduitProc = await startPortForward(bastionId, conduitIp, 6167, 'Conduit');
    const elementProc = await startPortForward(bastionId, elementIp, 8080, 'Element');
    const commandCenterProc = commandCenterIp
      ? await startPortForward(bastionId, commandCenterIp, 8090, 'Command Center')
      : null;

    console.log('\n✅ Connected! Open:');
    console.log('   Element: http://localhost:8080');
    if (commandCenterProc) {
      console.log('   Command Center: http://localhost:8090');
    }
    console.log('   Press Ctrl+C to disconnect\n');

    // Handle cleanup
    const cleanup = () => {
      console.log('\n\n🛑 Disconnecting...');
      conduitProc.kill();
      elementProc.kill();
      commandCenterProc?.kill();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Wait for processes
    const listeners: Array<Promise<unknown>> = [
      new Promise(resolve => conduitProc.on('exit', resolve)),
      new Promise(resolve => elementProc.on('exit', resolve)),
    ];
    if (commandCenterProc) {
      listeners.push(new Promise(resolve => commandCenterProc.on('exit', resolve)));
    }

    await Promise.race(listeners);

    cleanup();
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
