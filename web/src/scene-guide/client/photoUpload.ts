import { presignPhoto } from "../../scene-guide/client/sceneGuideApi";

const PHOTO_ACCEPT = "image/*";
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function isSupportedPhoto(file: File): boolean {
  return file.type.startsWith("image/") && file.size <= MAX_PHOTO_BYTES;
}

export function photoSizeError(file: File): string | null {
  if (!file.type.startsWith("image/")) return "仅支持上传图片";
  if (file.size > MAX_PHOTO_BYTES) return "单张照片不能超过 8 MB";
  return null;
}

/** 预签名上传一张照片到 MinIO，返回 objectKey 供生成任务卡使用。 */
export async function uploadGuidePhoto(file: File): Promise<string> {
  const upload = await presignPhoto({
    name: file.name,
    contentType: file.type || "image/jpeg",
    sizeBytes: file.size,
  });
  const response = await fetch(upload.url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "image/jpeg" },
  });
  if (!response.ok) {
    throw new Error("照片上传失败，请重试");
  }
  return upload.objectKey;
}

export { PHOTO_ACCEPT };
