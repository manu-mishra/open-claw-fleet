import * as cdk from 'aws-cdk-lib';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface EfsConstructProps {
  vpc: ec2.IVpc;
  allowedSecurityGroups?: ec2.ISecurityGroup[];
}

/**
 * EFS construct for persistent agent storage
 */
export class EfsConstruct extends Construct {
  public readonly fileSystem: efs.FileSystem;

  constructor(scope: Construct, id: string, props: EfsConstructProps) {
    super(scope, id);

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'EFS security group',
      allowAllOutbound: false,
    });

    this.fileSystem = new efs.FileSystem(this, 'FileSystem', {
      vpc: props.vpc,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      securityGroup,
      fileSystemPolicy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: [
              'elasticfilesystem:ClientMount',
              'elasticfilesystem:ClientWrite',
              'elasticfilesystem:ClientRootAccess',
            ],
            resources: ['*'],
          }),
        ],
      }),
    });

    // Allow NFS traffic from ECS tasks
    if (props.allowedSecurityGroups) {
      props.allowedSecurityGroups.forEach(sg => {
        securityGroup.addIngressRule(
          sg,
          ec2.Port.tcp(2049),
          'Allow NFS from ECS tasks'
        );
      });
    }

    // Access points for isolation
    this.fileSystem.addAccessPoint('AgentsAccessPoint', {
      path: '/agents',
      posixUser: { uid: '1000', gid: '1000' },
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
    });

    this.fileSystem.addAccessPoint('ConduitAccessPoint', {
      path: '/conduit',
      posixUser: { uid: '1000', gid: '1000' },
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
    });

    this.fileSystem.addAccessPoint('SharedAccessPoint', {
      path: '/shared',
      posixUser: { uid: '1000', gid: '1000' },
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
    });
  }
}
