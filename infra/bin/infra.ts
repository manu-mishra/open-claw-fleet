#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OpenClawFleetStack } from '../lib/open-claw-fleet-stack';

/**
 * CDK Application entry point for Open-Claw-Fleet.
 * 
 * This application creates and configures the OpenClawFleetStack
 * with environment-specific settings from AWS credentials.
 */
const app = new cdk.App();
new OpenClawFleetStack(app, 'OpenClawFleetStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
