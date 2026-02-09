import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ClusterCleanupProps {
  clusterArn: string;
}

export class ClusterCleanup extends Construct {
  constructor(scope: Construct, id: string, props: ClusterCleanupProps) {
    super(scope, id);

    // Lambda to stop all tasks in cluster
    const cleanupFunction = new lambda.Function(this, 'CleanupFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3
import time

ecs = boto3.client('ecs')

def handler(event, context):
    if event['RequestType'] != 'Delete':
        return {'PhysicalResourceId': 'ClusterCleanup'}
    
    cluster_arn = event['ResourceProperties']['ClusterArn']
    
    # List all tasks
    response = ecs.list_tasks(cluster=cluster_arn)
    task_arns = response.get('taskArns', [])
    
    print(f"Found {len(task_arns)} tasks to stop")
    
    # Stop each task
    for task_arn in task_arns:
        try:
            ecs.stop_task(cluster=cluster_arn, task=task_arn)
            print(f"Stopped task: {task_arn}")
        except Exception as e:
            print(f"Error stopping task {task_arn}: {e}")
    
    # Wait for tasks to stop
    if task_arns:
        print("Waiting for tasks to stop...")
        time.sleep(30)
    
    return {'PhysicalResourceId': 'ClusterCleanup'}
      `),
    });

    cleanupFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:ListTasks', 'ecs:StopTask'],
        resources: ['*'],
      })
    );

    const provider = new cr.Provider(this, 'CleanupProvider', {
      onEventHandler: cleanupFunction,
      logRetention: logs.RetentionDays.ONE_DAY,
    });

    new cdk.CustomResource(this, 'CleanupResource', {
      serviceToken: provider.serviceToken,
      properties: {
        ClusterArn: props.clusterArn,
      },
    });
  }
}
