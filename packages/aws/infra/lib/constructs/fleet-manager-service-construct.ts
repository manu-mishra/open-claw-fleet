import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { getEnvironmentConfig } from '../config';

export interface FleetManagerServiceConstructProps {
  cluster: ecs.Cluster;
  vpc: ec2.Vpc;
  fileSystem: efs.IFileSystem;
  repoUri: string;
  conduitSecurityGroup: ec2.SecurityGroup;
  agentTaskDefinitionArn: string;
  agentSecurityGroupId: string;
  fleetSecretArn: string;
  ceoSecretArn: string;
  configBucket: s3.Bucket;
  environment: string;
  securityGroup?: ec2.SecurityGroup;
}

export class FleetManagerServiceConstruct extends Construct {
  public readonly service: ecs.FargateService;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: FleetManagerServiceConstructProps) {
    super(scope, id);

    const config = getEnvironmentConfig(props.environment);

    this.securityGroup = props.securityGroup || new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Fleet Manager service',
    });

    // Allow fleet manager to talk to Conduit
    props.conduitSecurityGroup.addIngressRule(
      this.securityGroup,
      ec2.Port.tcp(6167),
      'Fleet Manager to Conduit'
    );

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // ECS permissions for RunTask
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask', 'ecs:StopTask', 'ecs:DescribeTasks', 'ecs:ListTasks'],
      resources: [
        props.agentTaskDefinitionArn,
        `arn:aws:ecs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:task/${props.cluster.clusterName}/*`,
      ],
    }));

    // PassRole for agent task
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'ecs-tasks.amazonaws.com',
        },
      },
    }));

    // Secrets Manager read
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.fleetSecretArn],
    }));

    // Secrets Manager update for CEO secret
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:UpdateSecret'],
      resources: [props.ceoSecretArn],
    }));

    // S3 read for config
    props.configBucket.grantRead(taskRole);

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Grant EFS mount permissions
    executionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:ClientRootAccess',
      ],
      resources: [props.fileSystem.fileSystemArn],
    }));

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Add EFS volume for config/workspaces
    const volumeName = 'fleet-data';
    taskDef.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        rootDirectory: '/',
      },
    });

    const fleetSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'FleetSecret',
      props.fleetSecretArn
    );

    taskDef.addContainer('fleet-manager', {
      image: ecs.ContainerImage.fromRegistry(props.repoUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'fleet-manager',
        logGroup: new logs.LogGroup(this, 'LogGroup', {
          logGroupName: `/ecs/fleet-manager-${props.environment}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        ENVIRONMENT: props.environment,
        ECS_CLUSTER_ARN: props.cluster.clusterArn,
        ECS_TASK_DEFINITION_ARN: props.agentTaskDefinitionArn,
        ECS_SUBNETS: props.vpc.privateSubnets.map(s => s.subnetId).join(','),
        ECS_SECURITY_GROUPS: props.agentSecurityGroupId,
        EFS_FILE_SYSTEM_ID: props.fileSystem.fileSystemId,
        AWS_REGION: cdk.Stack.of(this).region,
        FLEET_SECRET_ARN: props.fleetSecretArn,
        CEO_SECRET_ARN: props.ceoSecretArn,
        CONFIG_BUCKET: props.configBucket.bucketName,
        CONFIG_SYNC_ON_START: 'true',
        DEPLOY_VERSION: '1.0.1',
      },
      secrets: {
        FLEET_SECRET: ecs.Secret.fromSecretsManager(fleetSecret, 'secret'),
      },
    }).addMountPoints({
      sourceVolume: volumeName,
      containerPath: '/data',
      readOnly: false,
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.securityGroup],
    });

    // Grant EFS access
    props.fileSystem.grant(taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite');
  }
}
