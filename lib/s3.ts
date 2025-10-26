import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const region = process.env.S3_REGION || 'us-east-1'
const endpoint = process.env.S3_ENDPOINT || undefined

export const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: !!endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
})

export async function presignUpload(key: string, bucket: string, contentType: string) {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ACL: 'public-read' })
  return getSignedUrl(s3, cmd, { expiresIn: 60 })
}

export async function presignDownload(key: string, bucket: string, seconds = 60) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(s3, cmd, { expiresIn: seconds })
}
