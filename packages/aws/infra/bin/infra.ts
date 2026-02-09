#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { SharedStack } from '../lib/stacks/shared-stack';
import { EnvironmentStack } from '../lib/stacks/environment-stack';
import { Config } from '../lib/config';

const app = new cdk.App();

// Shared infrastructure (deploy once)
const sharedStack = new SharedStack(app, Config.getStackName('shared'), {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

// Environment-specific stacks
for (const environment of Config.environments) {
  new EnvironmentStack(app, Config.getStackName(environment), {
    environment,
    agentRepoUri: sharedStack.agentRepoUri,
    conduitRepoUri: sharedStack.conduitRepoUri,
    elementRepoUri: sharedStack.elementRepoUri,
    fleetManagerRepoUri: sharedStack.fleetManagerRepoUri,
    fileSystemId: sharedStack.fileSystemId,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
  });
}

app.synth();
