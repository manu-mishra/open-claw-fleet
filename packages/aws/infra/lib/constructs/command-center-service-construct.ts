import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface CommandCenterServiceConstructProps {
  cluster: ecs.Cluster;
  namespace: servicediscovery.PrivateDnsNamespace;
  vpc: ec2.Vpc;
  fileSystem: efs.IFileSystem;
  repoUri: string;
  conduitSecurityGroup: ec2.SecurityGroup;
  fleetSecretArn: string;
  environment: string;
  securityGroup?: ec2.SecurityGroup;
}

export class CommandCenterServiceConstruct extends Construct {
  public readonly service: ecs.FargateService;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: CommandCenterServiceConstructProps) {
    super(scope, id);

    this.securityGroup = props.securityGroup ?? new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Command Center service',
    });

    props.conduitSecurityGroup.addIngressRule(
      this.securityGroup,
      ec2.Port.tcp(6167),
      'Command Center to Conduit'
    );

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    executionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:ClientRootAccess',
      ],
      resources: [props.fileSystem.fileSystemArn],
    }));

    executionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.fleetSecretArn],
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

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/command-center-${props.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const volumeName = 'command-center-data';
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

    taskDef.addContainer('command-center', {
      image: ecs.ContainerImage.fromRegistry(props.repoUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'command-center',
        logGroup,
      }),
      environment: {
        PORT: '8090',
        DATA_DIR: '/data/command-center',
        SHARED_FILES_ROOT: '/data/shared',
        POSTGRES_DATA_DIR: '/data/postgres',
        ORG_FILE_PATH: '/data/workspaces/org.json',
        ORG_DEPLOYED_FILE_PATH: '/data/workspaces/deployed-org.json',
        WORKSPACES_ROOT: '/data/workspaces',
        MATRIX_HOMESERVER: `http://conduit.${props.namespace.namespaceName}:6167`,
        MATRIX_DOMAIN: props.namespace.namespaceName,
        COMMAND_CENTER_PUBLIC_URL: `http://command-center.${props.namespace.namespaceName}:8090`,
        COMMAND_CENTER_API_BASE_URL: 'http://127.0.0.1:8090',
        NEXT_PUBLIC_COMMAND_CENTER_API_BASE_URL: `http://command-center.${props.namespace.namespaceName}:8090`,
        TASK_ASSIGNMENT_BOT_MATRIX_ID: `@task.assignments:${props.namespace.namespaceName}`,
        COMMAND_CENTER_DB_MODE: 'postgres',
        PGHOST: '127.0.0.1',
        PGPORT: '5432',
        PGDATABASE: 'command_center',
        PGUSER: 'command_center',
      },
      secrets: {
        COMMAND_CENTER_API_TOKEN: ecs.Secret.fromSecretsManager(fleetSecret, 'secret'),
        MATRIX_PASSWORD_SEED: ecs.Secret.fromSecretsManager(fleetSecret, 'secret'),
        PGPASSWORD: ecs.Secret.fromSecretsManager(fleetSecret, 'secret'),
      },
      portMappings: [{ containerPort: 8090 }],
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
      cloudMapOptions: {
        name: 'command-center',
        cloudMapNamespace: props.namespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    props.fileSystem.grant(taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite');
  }
}
