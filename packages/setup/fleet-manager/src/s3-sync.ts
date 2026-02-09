import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export async function syncConfigFromS3(
  bucketName: string,
  localPath: string,
  region: string = 'us-east-1'
): Promise<void> {
  const s3 = new S3Client({ region });

  console.log(`📦 Syncing config from s3://${bucketName} to ${localPath}`);

  // List all objects in bucket
  const listCommand = new ListObjectsV2Command({ Bucket: bucketName });
  const listResponse = await s3.send(listCommand);

  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    console.log('⚠️  No files found in S3 bucket');
    return;
  }

  // Download each file
  for (const object of listResponse.Contents) {
    if (!object.Key) continue;

    const localFilePath = join(localPath, object.Key);
    
    // Create directory if needed
    await mkdir(dirname(localFilePath), { recursive: true });

    // Download file
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: object.Key,
    });
    const response = await s3.send(getCommand);
    
    if (response.Body) {
      const content = await response.Body.transformToString();
      await writeFile(localFilePath, content);
      console.log(`  ✓ ${object.Key}`);
    }
  }

  console.log(`✅ Synced ${listResponse.Contents.length} files`);
}
