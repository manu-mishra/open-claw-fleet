import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface BastionConstructProps {
  vpc: ec2.Vpc;
  fileSystemId?: string;
}

export class BastionConstruct extends Construct {
  public readonly instance: ec2.Instance;

  constructor(scope: Construct, id: string, props: BastionConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Add KMS permissions for SSM session encryption
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:DescribeKey',
      ],
      resources: ['*'], // SSM uses account default KMS key
    }));

    // Add ECS read permissions for helper scripts
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecs:ListTasks',
        'ecs:DescribeTasks',
        'ec2:DescribeInstances',
      ],
      resources: ['*'],
    }));

    // EFS mount permissions
    if (props.fileSystemId) {
      role.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientRootAccess',
          'elasticfilesystem:DescribeMountTargets',
        ],
        resources: [`arn:aws:elasticfilesystem:*:*:file-system/${props.fileSystemId}`],
      }));
    }

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'yum install -y amazon-efs-utils 2>/dev/null || true',
      `mkdir -p /mnt/efs`,
      ...(props.fileSystemId ? [
        `# Resolve mount target IP and mount via NFS (avoids DNS dependency)`,
        `TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")`,
        `AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)`,
        `MT_IP=$(aws efs describe-mount-targets --file-system-id ${props.fileSystemId} --region \${AZ%?} --query "MountTargets[?AvailabilityZoneName==\\\`$AZ\\\`].IpAddress" --output text)`,
        `mount -t nfs4 -o nfsvers=4.1 $MT_IP:/ /mnt/efs || true`,
      ] : []),
      'cat > /usr/local/bin/connect-element << \'EOF\'',
      '#!/bin/bash',
      'BASTION_ID=$(aws ec2 describe-instances --region us-east-1 \\',
      '  --filters "Name=tag:Name,Values=*Bastion*" "Name=instance-state-name,Values=running" \\',
      '  --query "Reservations[0].Instances[0].InstanceId" --output text)',
      'ELEMENT_IP=$(aws ecs list-tasks --cluster open-claw-fleet-dev --region us-east-1 \\',
      '  --query "taskArns[0]" --output text | \\',
      '  xargs -I {} aws ecs describe-tasks --cluster open-claw-fleet-dev --region us-east-1 --tasks {} \\',
      '  --query "tasks[0].attachments[0].details[?name==\\`privateIPv4Address\\`].value" --output text)',
      'echo "Bastion: $BASTION_ID"',
      'echo "Element IP: $ELEMENT_IP"',
      'echo "Access at: http://localhost:8080"',
      'aws ssm start-session --target $BASTION_ID --region us-east-1 \\',
      '  --document-name AWS-StartPortForwardingSessionToRemoteHost \\',
      '  --parameters "{\\"host\\":[\\"$ELEMENT_IP\\"],\\"portNumber\\":[\\"8080\\"],\\"localPortNumber\\":[\\"8080\\"]}"',
      'EOF',
      'chmod +x /usr/local/bin/connect-element',
      'echo "Helper script installed: connect-element"'
    );

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      userData,
    });
  }
}
