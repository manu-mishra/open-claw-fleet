import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { getEnvironmentConfig } from '../config';

export interface ElementServiceConstructProps {
  cluster: ecs.Cluster;
  vpc: ec2.Vpc;
  repoUri: string;
  conduitSecurityGroup: ec2.SecurityGroup;
  environment: string;
  securityGroup?: ec2.SecurityGroup;
}

export class ElementServiceConstruct extends Construct {
  public readonly service: ecs.FargateService;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ElementServiceConstructProps) {
    super(scope, id);

    const config = getEnvironmentConfig(props.environment);

    this.securityGroup = props.securityGroup || new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Element web UI',
    });

    props.conduitSecurityGroup.addIngressRule(
      this.securityGroup,
      ec2.Port.tcp(6167),
      'Element to Conduit'
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

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: config.cpu,
      memoryLimitMiB: config.memory,
      taskRole,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    taskDef.addContainer('element', {
      image: ecs.ContainerImage.fromRegistry(props.repoUri),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'element',
        logGroup: new logs.LogGroup(this, 'LogGroup', {
          logGroupName: `/ecs/element-${props.environment}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        DEFAULT_SERVER_NAME: 'conduit.anycompany.corp',
        NGINX_PORT: '8080',
      },
      portMappings: [{ containerPort: 8080 }],
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.securityGroup],
    });
  }
}
