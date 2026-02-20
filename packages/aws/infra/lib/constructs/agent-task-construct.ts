import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { getEnvironmentConfig } from '../config';

export interface AgentTaskConstructProps {
  cluster: ecs.Cluster;
  vpc: ec2.Vpc;
  repoUri: string;
  conduitSecurityGroup: ec2.SecurityGroup;
  fileSystem: efs.IFileSystem;
  environment: string;
  securityGroup?: ec2.SecurityGroup;
  fleetSecretArn: string;
}

export class AgentTaskConstruct extends Construct {
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props: AgentTaskConstructProps) {
    super(scope, id);

    const config = getEnvironmentConfig(props.environment);

    this.securityGroup = props.securityGroup || new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Agent tasks',
    });

    props.conduitSecurityGroup.addIngressRule(
      this.securityGroup,
      ec2.Port.tcp(6167),
      'Agents to Conduit'
    );

    this.taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    this.taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:openclaw/${props.environment}/fleet-secret*`,
        `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:openclaw/${props.environment}/ceo*`,
      ],
    }));

    // Grant EFS mount permissions with access point support
    executionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite',
      ],
      resources: [props.fileSystem.fileSystemArn],
      conditions: {
        StringEquals: {
          'elasticfilesystem:AccessPointArn': `${props.fileSystem.fileSystemArn}/access-point/*`,
        },
      },
    }));

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: config.cpu,
      memoryLimitMiB: config.memory,
      taskRole: this.taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Add EFS volume for agent persistence (access point will be specified at runtime)
    const volumeName = 'agent-data';
    this.taskDefinition.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        // Note: Access point ID will be provided via task overrides at runtime
        // This allows dynamic per-agent isolation without redeploying task definition
        authorizationConfig: {
          iam: 'ENABLED',
        },
      },
    });

    const fleetSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'FleetSecret',
      props.fleetSecretArn
    );

    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [fleetSecret.secretArn],
    }));

    this.taskDefinition.addContainer('agent', {
      image: ecs.ContainerImage.fromRegistry(props.repoUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'agent',
        logGroup: new logs.LogGroup(this, 'LogGroup', {
          logGroupName: `/ecs/agent-${props.environment}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        MATRIX_HOMESERVER: 'http://conduit.anycompany.corp:6167',
        MATRIX_DOMAIN: 'anycompany.corp',
        COMMAND_CENTER_URL: 'http://command-center.anycompany.corp:8090',
      },
      secrets: {
        FLEET_SECRET: ecs.Secret.fromSecretsManager(fleetSecret, 'secret'),
        COMMAND_CENTER_API_TOKEN: ecs.Secret.fromSecretsManager(fleetSecret, 'secret'),
      },
    }).addMountPoints({
      sourceVolume: volumeName,
      containerPath: '/workspace',  // Changed from /data to /workspace for isolation
      readOnly: false,
    });
  }
}
