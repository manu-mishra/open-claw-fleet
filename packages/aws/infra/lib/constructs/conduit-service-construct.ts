import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { getEnvironmentConfig } from '../config';

export interface ConduitServiceConstructProps {
  cluster: ecs.Cluster;
  namespace: servicediscovery.PrivateDnsNamespace;
  vpc: ec2.Vpc;
  fileSystem: efs.IFileSystem;
  repoUri: string;
  environment: string;
  securityGroup?: ec2.SecurityGroup;
}

export class ConduitServiceConstruct extends Construct {
  public readonly service: ecs.FargateService;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly serverName: string;

  constructor(scope: Construct, id: string, props: ConduitServiceConstructProps) {
    super(scope, id);

    const config = getEnvironmentConfig(props.environment);
    this.serverName = 'anycompany.corp';

    this.securityGroup = props.securityGroup || new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Conduit Matrix server',
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

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
      cpu: config.cpu,
      memoryLimitMiB: config.memory,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      ephemeralStorageGiB: 21,
    });

    const volumeName = 'conduit-data';
    taskDef.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
      },
    });

    taskDef.addContainer('conduit', {
      image: ecs.ContainerImage.fromRegistry(props.repoUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'conduit',
        logGroup: new logs.LogGroup(this, 'LogGroup', {
          logGroupName: `/ecs/conduit-${props.environment}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        CONDUIT_CONFIG: '/etc/conduit.toml',
        CONDUIT_SERVER_NAME: this.serverName,
        CONDUIT_DATABASE_BACKEND: 'rocksdb',
        CONDUIT_ALLOW_REGISTRATION: 'true',
        CONDUIT_DATABASE_PATH: '/var/lib/matrix-conduit/database',
        CONDUIT_PORT: '6167',
      },
      portMappings: [{ containerPort: 6167, name: 'matrix' }],
    }).addMountPoints({
      sourceVolume: volumeName,
      containerPath: '/var/lib/matrix-conduit',
      readOnly: false,
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.securityGroup],
      cloudMapOptions: {
        name: 'conduit',
        cloudMapNamespace: props.namespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });
  }
}
