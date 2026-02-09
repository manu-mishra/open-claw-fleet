import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { Config } from '../config';

export interface ConfigBucketConstructProps {
  environment: string;
}

export class ConfigBucketConstruct extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ConfigBucketConstructProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `${Config.projectPrefix}-config-${props.environment}-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Deploy config files from local to S3
    new s3deploy.BucketDeployment(this, 'DeployConfig', {
      sources: [s3deploy.Source.asset('../../../config/environments/aws')],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'environments/aws',
    });

    new cdk.CfnOutput(this, 'ConfigBucketName', {
      value: this.bucket.bucketName,
    });
  }
}
