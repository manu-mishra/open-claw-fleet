import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface FleetOrchestratorConstructProps {
  cluster: ecs.Cluster;
  vpc: ec2.Vpc;
  agentTaskDefinition: ecs.FargateTaskDefinition;
  agentTaskRole: iam.Role;
  agentExecutionRole: iam.IRole;
  agentSecurityGroup: ec2.SecurityGroup;
}

export class FleetOrchestratorConstruct extends Construct {
  public readonly orchestratorRole: iam.Role;

  constructor(scope: Construct, id: string, props: FleetOrchestratorConstructProps) {
    super(scope, id);

    this.orchestratorRole = new iam.Role(this, 'OrchestratorRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        new iam.ServicePrincipal('lambda.amazonaws.com')
      ),
    });

    this.orchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask', 'ecs:StopTask', 'ecs:DescribeTasks', 'ecs:ListTasks'],
      resources: [
        props.agentTaskDefinition.taskDefinitionArn,
        `arn:aws:ecs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:task/${props.cluster.clusterName}/*`,
      ],
    }));

    this.orchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [
        props.agentTaskRole.roleArn,
        props.agentExecutionRole.roleArn,
      ],
    }));

    new cdk.CfnOutput(this, 'OrchestratorRoleArn', {
      value: this.orchestratorRole.roleArn,
    });
  }
}
