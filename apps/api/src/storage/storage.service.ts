import type { ApiEnvironment } from "@createcanyon/config";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { API_ENV } from "../common/tokens.js";

@Injectable()
export class StorageService {
  public readonly client: S3Client;
  public constructor(@Inject(API_ENV) public readonly environment: ApiEnvironment) {
    this.client = new S3Client({
      region: environment.S3_REGION,
      ...(environment.S3_ENDPOINT ? { endpoint: environment.S3_ENDPOINT } : {}),
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: environment.S3_ACCESS_KEY_ID,
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  public async createUploadUrl(input: {
    readonly key: string;
    readonly contentType: string;
    readonly byteSize: number;
    readonly sha256Hex: string;
  }) {
    const checksum = Buffer.from(input.sha256Hex, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.environment.S3_QUARANTINE_BUCKET,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.byteSize,
      ChecksumSHA256: checksum,
      Metadata: { declaredsha256: input.sha256Hex },
      ServerSideEncryption: this.environment.S3_ENDPOINT ? undefined : "aws:kms",
    });
    return {
      url: await getSignedUrl(this.client, command, { expiresIn: this.environment.UPLOAD_URL_TTL_SECONDS }),
      headers: {
        "content-type": input.contentType,
        "x-amz-checksum-sha256": checksum,
        "x-amz-meta-declaredsha256": input.sha256Hex,
      },
      expiresInSeconds: this.environment.UPLOAD_URL_TTL_SECONDS,
    };
  }

  public async headQuarantined(key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: this.environment.S3_QUARANTINE_BUCKET, Key: key }));
  }

  public async createDownloadUrl(input: { readonly bucket: string; readonly key: string; readonly filename: string }) {
    const safeFilename = input.filename.replace(/["\\\r\n]/g, "_");
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      ResponseCacheControl: "private, no-store",
    }), { expiresIn: this.environment.DOWNLOAD_URL_TTL_SECONDS });
  }
}
