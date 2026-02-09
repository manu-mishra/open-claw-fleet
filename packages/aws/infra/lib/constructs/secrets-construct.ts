import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface SecretsConstructProps {
  environment: string;
}

export class SecretsConstruct extends Construct {
  public readonly fleetSecret: secretsmanager.Secret;
  public readonly ceoSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsConstructProps) {
    super(scope, id);

    // Fleet secret for password derivation
    this.fleetSecret = new secretsmanager.Secret(this, 'FleetSecret', {
      secretName: `openclaw/${props.environment}/fleet-secret`,
      description: 'Master secret for deriving agent passwords',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'secret',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // CEO credentials (will be populated by fleet manager)
    this.ceoSecret = new secretsmanager.Secret(this, 'CeoSecret', {
      secretName: `openclaw/${props.environment}/ceo`,
      description: 'CEO Matrix credentials',
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        username: 'placeholder',
        password: 'placeholder',
        matrixId: 'placeholder',
      })),
    });

    new cdk.CfnOutput(this, 'FleetSecretArn', {
      value: this.fleetSecret.secretArn,
    });

    new cdk.CfnOutput(this, 'CeoSecretArn', {
      value: this.ceoSecret.secretArn,
    });
  }
}
