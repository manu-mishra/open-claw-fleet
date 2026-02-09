import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';
import { getEnvironmentConfig } from '../config';
import { NetworkConstruct } from '../constructs/network-construct';
import { ClusterConstruct } from '../constructs/cluster-construct';
import { BastionConstruct } from '../constructs/bastion-construct';
import { ConduitServiceConstruct } from '../constructs/conduit-service-construct';
import { ElementServiceConstruct } from '../constructs/element-service-construct';
import { AgentTaskConstruct } from '../constructs/agent-task-construct';
import { FleetOrchestratorConstruct } from '../constructs/fleet-orchestrator-construct';
import { FleetManagerServiceConstruct } from '../constructs/fleet-manager-service-construct';
import { ClusterCleanup } from '../constructs/cluster-cleanup-construct';

import { SecretsConstruct } from '../constructs/secrets-construct';
import { ConfigBucketConstruct } from '../constructs/config-bucket-construct';

export interface EnvironmentStackProps extends cdk.StackProps {
  environment: string;
  agentRepoUri: string;
  conduitRepoUri: string;
  elementRepoUri: string;
  fleetManagerRepoUri: string;
  fileSystemId: string;
  configBucketName?: string;
}

export class EnvironmentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EnvironmentStackProps) {
    super(scope, id, props);

    const network = new NetworkConstruct(this, 'Network', {
      environment: props.environment,
    });

    const secrets = new SecretsConstruct(this, 'Secrets', {
      environment: props.environment,
    });

    const configBucket = new ConfigBucketConstruct(this, 'ConfigBucket', {
      environment: props.environment,
    });

    const cluster = new ClusterConstruct(this, 'Cluster', {
      environment: props.environment,
      vpc: network.vpc,
    });

    const bastion = new BastionConstruct(this, 'Bastion', {
      vpc: network.vpc,
      fileSystemId: props.fileSystemId,
    });

    // Create security groups first
    const conduitSg = new ec2.SecurityGroup(this, 'ConduitSecurityGroup', {
      vpc: network.vpc,
      description: 'Conduit service security group',
    });

    const agentSg = new ec2.SecurityGroup(this, 'AgentSecurityGroup', {
      vpc: network.vpc,
      description: 'Agent task security group',
    });

    const fleetManagerSg = new ec2.SecurityGroup(this, 'FleetManagerSecurityGroup', {
      vpc: network.vpc,
      description: 'Fleet Manager security group',
    });

    const elementSg = new ec2.SecurityGroup(this, 'ElementSecurityGroup', {
      vpc: network.vpc,
      description: 'Element web UI security group',
    });

    // Allow bastion to access Element and Conduit
    elementSg.addIngressRule(
      bastion.instance.connections.securityGroups[0],
      ec2.Port.tcp(8080),
      'Allow bastion to access Element UI'
    );

    conduitSg.addIngressRule(
      bastion.instance.connections.securityGroups[0],
      ec2.Port.tcp(6167),
      'Allow bastion to access Conduit'
    );

    // Import EFS from shared stack (mount targets created here for this VPC)
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc: network.vpc,
      description: 'EFS security group',
      allowAllOutbound: false,
    });

    const fileSystem = efs.FileSystem.fromFileSystemAttributes(this, 'Efs', {
      fileSystemId: props.fileSystemId,
      securityGroup: efsSecurityGroup,
    });

    // Create mount targets in private subnets
    for (const [i, subnet] of network.vpc.privateSubnets.entries()) {
      new efs.CfnMountTarget(this, `EfsMountTarget${i}`, {
        fileSystemId: props.fileSystemId,
        subnetId: subnet.subnetId,
        securityGroups: [efsSecurityGroup.securityGroupId],
      });
    }

    // Allow NFS from ECS tasks and bastion
    for (const sg of [conduitSg, agentSg, fleetManagerSg, bastion.instance.connections.securityGroups[0]]) {
      efsSecurityGroup.addIngressRule(sg, ec2.Port.tcp(2049), 'Allow NFS');
    }

    const conduit = new ConduitServiceConstruct(this, 'Conduit', {
      cluster: cluster.cluster,
      namespace: cluster.namespace,
      vpc: network.vpc,
      fileSystem: fileSystem,
      repoUri: props.conduitRepoUri,
      environment: props.environment,
      securityGroup: conduitSg,
    });

    const element = new ElementServiceConstruct(this, 'Element', {
      cluster: cluster.cluster,
      vpc: network.vpc,
      repoUri: props.elementRepoUri,
      conduitSecurityGroup: conduit.securityGroup,
      environment: props.environment,
      securityGroup: elementSg,
    });

    const agentTask = new AgentTaskConstruct(this, 'AgentTask', {
      cluster: cluster.cluster,
      vpc: network.vpc,
      repoUri: props.agentRepoUri,
      conduitSecurityGroup: conduit.securityGroup,
      fileSystem: fileSystem,
      environment: props.environment,
      securityGroup: agentSg,
      fleetSecretArn: secrets.fleetSecret.secretArn,
    });

    const orchestrator = new FleetOrchestratorConstruct(this, 'FleetOrchestrator', {
      cluster: cluster.cluster,
      vpc: network.vpc,
      agentTaskDefinition: agentTask.taskDefinition,
      agentTaskRole: agentTask.taskRole,
      agentExecutionRole: agentTask.taskDefinition.executionRole!,
      agentSecurityGroup: agentTask.securityGroup,
    });

    const fleetManager = new FleetManagerServiceConstruct(this, 'FleetManager', {
      cluster: cluster.cluster,
      vpc: network.vpc,
      fileSystem: fileSystem,
      repoUri: props.fleetManagerRepoUri,
      conduitSecurityGroup: conduit.securityGroup,
      agentTaskDefinitionArn: agentTask.taskDefinition.taskDefinitionArn,
      agentSecurityGroupId: agentTask.securityGroup.securityGroupId,
      fleetSecretArn: secrets.fleetSecret.secretArn,
      ceoSecretArn: secrets.ceoSecret.secretArn,
      configBucket: configBucket.bucket,
      environment: props.environment,
      securityGroup: fleetManagerSg,
    });

    // Cleanup all tasks before cluster deletion
    // Note: Custom resource will run on DELETE, stopping tasks before cluster is removed
    new ClusterCleanup(this, 'ClusterCleanup', {
      clusterArn: cluster.cluster.clusterArn,
    });

    new cdk.CfnOutput(this, 'ConduitServerName', {
      value: conduit.serverName,
    });

    new cdk.CfnOutput(this, 'AgentTaskDefinitionArn', {
      value: agentTask.taskDefinition.taskDefinitionArn,
    });

    new cdk.CfnOutput(this, 'AgentSecurityGroupId', {
      value: agentTask.securityGroup.securityGroupId,
    });

    new cdk.CfnOutput(this, 'ClusterArn', {
      value: cluster.cluster.clusterArn,
    });

    new cdk.CfnOutput(this, 'EfsFileSystemId', {
      value: props.fileSystemId,
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: network.vpc.privateSubnets.map(s => s.subnetId).join(','),
    });

    new cdk.CfnOutput(this, 'FleetSecretArn', {
      value: secrets.fleetSecret.secretArn,
    });

    new cdk.CfnOutput(this, 'CeoSecretArn', {
      value: secrets.ceoSecret.secretArn,
    });

    new cdk.CfnOutput(this, 'OrchestratorRoleArn', {
      value: orchestrator.orchestratorRole.roleArn,
    });
  }
}
