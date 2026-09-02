import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import type {
  ObjectStoragePort,
  PresignedDownload,
  PresignedUpload,
  PresignedUploadPart,
} from "./object-storage.port.js";

export class MinioObjectStorageService implements ObjectStoragePort {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor(
    private readonly bucket: string,
    input: {
      endpoint: string;
      publicEndpoint?: string;
      accessKey: string;
      secretKey: string;
      region?: string;
      forcePathStyle?: boolean;
    },
  ) {
    const common = {
      region: input.region ?? "us-east-1",
      forcePathStyle: input.forcePathStyle ?? true,
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      responseChecksumValidation: "WHEN_REQUIRED" as const,
      credentials: {
        accessKeyId: input.accessKey,
        secretAccessKey: input.secretKey,
      },
    };
    this.client = new S3Client({ ...common, endpoint: input.endpoint });
    this.presignClient = new S3Client({
      ...common,
      endpoint: input.publicEndpoint ?? input.endpoint,
    });
  }

  async downloadObject(input: {
    objectKey: string;
    destinationPath: string;
  }): Promise<void> {
    const body = await this.readObject({ objectKey: input.objectKey });
    await pipeline(
      body,
      createWriteStream(input.destinationPath, { flags: "wx" }),
    );
  }

  async readObject(input: {
    objectKey: string;
  }): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
    );
    if (!result.Body) {
      throw new Error("MinIO object body is unavailable");
    }
    return result.Body as NodeJS.ReadableStream;
  }

  async uploadObject(input: {
    objectKey: string;
    sourcePath: string;
    contentType: string;
  }): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: createReadStream(input.sourcePath),
        ContentType: input.contentType,
      }),
    );
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.bucket }),
      );
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (error) {
        await this.client.send(
          new HeadBucketCommand({ Bucket: this.bucket }),
        );
        void error;
      }
    }
  }

  async createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    checksumSha256: string;
  }): Promise<{ uploadId: string }> {
    await this.ensureBucket();
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        Metadata: {
          "expected-sha256": input.checksumSha256,
        },
      }),
    );
    if (!result.UploadId) {
      throw new Error("MinIO did not return a multipart upload id");
    }
    return { uploadId: result.UploadId };
  }

  async presignUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<PresignedUploadPart> {
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1_000,
    );
    const url = await getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return { partNumber: input.partNumber, url, expiresAt };
  }

  async presignDownloadObject(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload> {
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1_000,
    );
    const url = await getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return { url, expiresAt };
  }

  async presignUploadObject(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<PresignedUpload> {
    await this.ensureBucket();
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1_000,
    );
    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return { objectKey: input.objectKey, url, expiresAt };
  }

  async getObjectBytes(input: {
    objectKey: string;
  }): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
    );
    if (!result.Body) {
      throw new Error("MinIO object body is unavailable");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(input: { objectKey: string }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
    );
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<{ etag?: string }> {
    const result = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
    return { etag: result.ETag };
  }

  async headObject(input: { objectKey: string }): Promise<{
    sizeBytes: string;
    etag?: string;
    contentType?: string;
  }> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
    );
    if (result.ContentLength === undefined) {
      throw new Error("MinIO object size is unavailable");
    }
    return {
      sizeBytes: String(result.ContentLength),
      etag: result.ETag,
      contentType: result.ContentType,
    };
  }

  async abortMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
  }): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
      }),
    );
  }
}
