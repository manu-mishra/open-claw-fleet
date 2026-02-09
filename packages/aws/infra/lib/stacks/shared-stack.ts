import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';
import { Config } from '../config';

/**
 * Shared stack - ECR repos + EFS (persists across environment deploys)
 */
export class SharedStack extends cdk.Stack {
  public readonly agentRepoUri: string;
  public readonly conduitRepoUri: string;
  public readonly elementRepoUri: string;
  public readonly fleetManagerRepoUri: string;
  public readonly fileSystemId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const agentRepo = new ecr.Repository(this, 'AgentRepo', {
      repositoryName: `${Config.projectPrefix}/openclaw-agent`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const conduitRepo = new ecr.Repository(this, 'ConduitRepo', {
      repositoryName: `${Config.projectPrefix}/conduit-matrix`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const elementRepo = new ecr.Repository(this, 'ElementRepo', {
      repositoryName: `${Config.projectPrefix}/element-web`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fleetManagerRepo = new ecr.Repository(this, 'FleetManagerRepo', {
      repositoryName: `${Config.projectPrefix}/fleet-manager`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.agentRepoUri = agentRepo.repositoryUri;
    this.conduitRepoUri = conduitRepo.repositoryUri;
    this.elementRepoUri = elementRepo.repositoryUri;
    this.fleetManagerRepoUri = fleetManagerRepo.repositoryUri;

    // EFS filesystem only (no VPC/mount targets - those go in environment stack)
    // RETAIN so data survives environment stack destroys
    const cfnFs = new efs.CfnFileSystem(this, 'FileSystem', {
      encrypted: true,
      fileSystemPolicy: {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: '*' },
          Action: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:ClientRootAccess',
          ],
        }],
      },
    });
    cfnFs.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    this.fileSystemId = cfnFs.ref;

    new cdk.CfnOutput(this, 'AgentRepoUri', { value: this.agentRepoUri });
    new cdk.CfnOutput(this, 'ConduitRepoUri', { value: this.conduitRepoUri });
    new cdk.CfnOutput(this, 'ElementRepoUri', { value: this.elementRepoUri });
    new cdk.CfnOutput(this, 'FleetManagerRepoUri', { value: this.fleetManagerRepoUri });
    new cdk.CfnOutput(this, 'EfsFileSystemId', { value: this.fileSystemId });
  }
}
