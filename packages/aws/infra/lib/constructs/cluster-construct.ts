import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { Config } from '../config';

export interface ClusterConstructProps {
  environment: string;
  vpc: ec2.IVpc;
}

export class ClusterConstruct extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly namespace: servicediscovery.PrivateDnsNamespace;

  constructor(scope: Construct, id: string, props: ClusterConstructProps) {
    super(scope, id);

    this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
      vpc: props.vpc,
      name: 'anycompany.corp',
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${Config.projectPrefix}-${props.environment}`,
      vpc: props.vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });
  }
}
