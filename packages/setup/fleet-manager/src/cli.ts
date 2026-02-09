#!/usr/bin/env node
import { program } from 'commander';
import { FleetManager } from './index.js';
import { syncConfigFromS3 } from './s3-sync.js';

program
  .name('fleet-manager')
  .description('Manage OpenClaw agent fleet');

program
  .command('start')
  .description('Start fleet manager (generate, deploy, watch)')
  .option('-e, --env <name>', 'Environment name', 'local')
  .action(async (opts) => {
    const secret = process.env.FLEET_SECRET;
    if (!secret) {
      console.error('FLEET_SECRET environment variable required');
      process.exit(1);
    }

    // Sync config from S3 if configured
    if (process.env.CONFIG_SYNC_ON_START === 'true' && process.env.CONFIG_BUCKET) {
      try {
        await syncConfigFromS3(
          process.env.CONFIG_BUCKET,
          '/data/config',
          process.env.AWS_REGION || 'us-east-1'
        );
      } catch (error) {
        console.error('Failed to sync config from S3:', error);
        process.exit(1);
      }
    }

    const manager = new FleetManager(opts.env, secret);
    
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await manager.stop();
      process.exit(0);
    });

    await manager.start();
  });

program
  .command('generate')
  .description('Generate workspaces only (no deploy)')
  .option('-e, --env <name>', 'Environment name', 'local')
  .action(async (opts) => {
    const manager = new FleetManager(opts.env, 'unused');
    await manager.generate();
  });

program
  .command('deploy')
  .description('Deploy agents from existing workspaces')
  .option('-e, --env <name>', 'Environment name', 'local')
  .action(async (opts) => {
    const secret = process.env.FLEET_SECRET;
    if (!secret) {
      console.error('FLEET_SECRET environment variable required');
      process.exit(1);
    }
    const manager = new FleetManager(opts.env, secret);
    await manager.deploy();
  });

program
  .command('stop')
  .description('Stop all running agents')
  .option('-e, --env <name>', 'Environment name', 'local')
  .action(async (opts) => {
    const manager = new FleetManager(opts.env, 'unused');
    await manager.stop();
  });

program.parse();
