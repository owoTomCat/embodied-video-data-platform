import { MinioObjectStorageService } from "../src/storage/minio-object-storage.service.js";
import { ObjectStorageSizeLimitError } from "../src/storage/object-storage.port.js";

describe("MinioObjectStorageService presigned uploads", () => {
  it("signs browser uploads with the public endpoint and no empty checksum", async () => {
    const storage = new MinioObjectStorageService("evdp-videos", {
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      accessKey: "local-access-key",
      secretKey: "local-secret-key",
    });

    const result = await storage.presignUploadPart({
      objectKey: "uploads/team/user/submission/original.mp4",
      uploadId: "upload-id",
      partNumber: 1,
      expiresInSeconds: 900,
    });

    const url = new URL(result.url);
    expect(url.origin).toBe("http://localhost:9000");
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
  });

  it("binds the declared size and content type to single-object upload URLs", async () => {
    const storage = new MinioObjectStorageService("evdp-videos", {
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      accessKey: "local-access-key",
      secretKey: "local-secret-key",
    });
    vi.spyOn(storage, "ensureBucket").mockResolvedValue();

    const result = await storage.presignUploadObject({
      objectKey: "scene-guide/user/photo/image.jpg",
      contentType: "image/jpeg",
      sizeBytes: 8_192,
      expiresInSeconds: 600,
    });

    const url = new URL(result.url);
    const signedHeaders = [...url.searchParams.entries()].find(
      ([name]) => name.toLowerCase() === "x-amz-signedheaders",
    )?.[1];
    expect(signedHeaders?.split(";")).toEqual(
      expect.arrayContaining(["content-length", "content-type", "host"]),
    );
  });

  it("stops reading a single object as soon as it exceeds the byte limit", async () => {
    const storage = new MinioObjectStorageService("evdp-videos", {
      endpoint: "http://minio:9000",
      accessKey: "local-access-key",
      secretKey: "local-secret-key",
    });
    let chunksRead = 0;
    const body = {
      async *[Symbol.asyncIterator]() {
        chunksRead += 1;
        yield Buffer.alloc(5);
        chunksRead += 1;
        yield Buffer.alloc(5);
        chunksRead += 1;
        yield Buffer.alloc(5);
      },
    };
    Object.defineProperty(storage, "client", {
      value: { send: vi.fn().mockResolvedValue({ Body: body }) },
    });

    await expect(
      storage.getObjectBytes({
        objectKey: "scene-guide/user/photo/image.jpg",
        maxBytes: 8,
      }),
    ).rejects.toBeInstanceOf(ObjectStorageSizeLimitError);
    expect(chunksRead).toBe(2);
  });
});
