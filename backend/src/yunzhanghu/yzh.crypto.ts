import { createCipheriv, createDecipheriv, createSign, createVerify } from "node:crypto";

/**
 * 云账户 加密&签名（RSA）封装。
 *
 * 依据云账户《接口规范·加密&签名（RSA）》：
 * - data：业务参数用 3DES（DESede/CBC/PKCS5Padding）加密后 Base64；
 * - sign：对 `data=..&mess=..&timestamp=..&key=appKey` 串用 RSA-SHA256（PKCS#1 v1.5）签名，Base64 输出。
 * 与官方 @yunzhanghu/sdk-nodejs 行为一致；若后续引入官方 SDK，可仅替换本文件。
 */

const DES_ALGO = "des-ede3-cbc";

/** 取 3DES 前 8 字节作为 CBC 的 IV（云账户约定）。 */
function ivOf(des3Key: Buffer): Buffer {
  return des3Key.subarray(0, 8);
}

/** 3DES / DESede 的 key 长度要求：支持 16 或 24 字节。 */
function normalizeDesKey(des3Key: Buffer): Buffer {
  if (des3Key.length !== 16 && des3Key.length !== 24) {
    // Node 的 des-ede3-cbc 只接受 16/24 字节；云账户提供的 key 为 24 字节。
    if (des3Key.length > 24) return des3Key.subarray(0, 24);
    throw new Error(
      `[yunzhanghu] 3DES Key 长度应为 16 或 24 字节，当前 ${des3Key.length}`,
    );
  }
  return des3Key;
}

/** 3DES 加密：明文 → Base64。 */
export function des3Encrypt(plaintext: string, des3Key: string): string {
  const key = normalizeDesKey(Buffer.from(des3Key, "utf8"));
  const iv = ivOf(key);
  const cipher = createCipheriv(DES_ALGO, key, iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return encrypted.toString("base64");
}

/** 3DES 解密：Base64 → 明文。 */
export function des3Decrypt(ciphertext: string, des3Key: string): string {
  const key = normalizeDesKey(Buffer.from(des3Key, "utf8"));
  const iv = ivOf(key);
  const decipher = createDecipheriv(DES_ALGO, key, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** 生成待签名字符串：data=..&mess=..&timestamp=..&key=appKey。 */
export function signPayload(
  data: string,
  mess: string,
  timestamp: string,
  appKey: string,
): string {
  return `data=${data}&mess=${mess}&timestamp=${timestamp}&key=${appKey}`;
}

/** RSA-SHA256 签名（用平台企业私钥），返回 Base64。 */
export function rsaSign(
  data: string,
  mess: string,
  timestamp: string,
  appKey: string,
  privateKey: string,
): string {
  const signer = createSign("RSA-SHA256");
  signer.update(signPayload(data, mess, timestamp, appKey), "utf8");
  const signature = signer.sign(privateKey);
  return signature.toString("base64");
}

/** 验签（用云账户公钥验证云账户回调的签名）。 */
export function rsaVerify(
  data: string,
  mess: string,
  timestamp: string,
  appKey: string,
  sign: string,
  yzhPublicKey: string,
): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signPayload(data, mess, timestamp, appKey), "utf8");
  return verifier.verify(yzhPublicKey, Buffer.from(sign, "base64"));
}
