import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, MoreThan, Repository, type EntityManager } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { csvDocument } from "../csv/csv.js";
import {
  DeliveryArchiveTaskEntity,
  type DeliveryArchiveFormat,
} from "../database/entities/delivery-archive-task.entity.js";
import { DeliveryPackageEntity } from "../database/entities/delivery-package.entity.js";
import { DeliveryPackageItemEntity } from "../database/entities/delivery-package-item.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { PointCycleItemEntity } from "../database/entities/point-cycle-item.entity.js";
import { loadLatestPointCycleAdjustments } from "../points/latest-point-cycle-adjustments.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  acceptedAnnotationRun,
  type AcceptedDeliveryAnnotation,
} from "./delivery-annotation.js";
import { DeliveryFailure } from "./delivery-failure.js";

const DELIVERY_DOWNLOAD_URL_TTL_SECONDS = 30 * 60;
const DELIVERY_ARCHIVE_DOWNLOAD_URL_TTL_SECONDS = 30 * 60;
const DELIVERY_ARCHIVE_LEASE_MS = 60_000;
const DELIVERY_ARCHIVE_HEARTBEAT_MS = 15_000;
const DELIVERY_ARCHIVE_MAX_ATTEMPTS = 3;
const DELIVERY_ARCHIVE_CLAIM_LOCK_KEY = 1_308_240_003;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffffn;
const ZIP64_VERSION = 45;
const ZIP_STORE_VERSION = 20;
const ZIP_CRC32_TABLE = new Uint32Array(256);

function deliveryArchiveConcurrency(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 4);
}

export const DELIVERY_ARCHIVE_GLOBAL_CONCURRENCY =
  deliveryArchiveConcurrency(process.env.DELIVERY_ARCHIVE_CONCURRENCY);

export type DeliveryArchiveClaim = {
  taskId: string;
  leaseToken: string;
  leaseOwner: string;
  attemptCount: number;
};

class DeliveryArchiveLeaseLostError extends Error {
  constructor(taskId: string) {
    super(`Delivery archive task ${taskId} lease is no longer active`);
    this.name = "DeliveryArchiveLeaseLostError";
  }
}

for (let index = 0; index < ZIP_CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  ZIP_CRC32_TABLE[index] = value >>> 0;
}

type Candidate = {
  pointItem: PointCycleItemEntity;
  submission: SubmissionEntity;
  sizeBytes: string;
  finalScore: string;
  points: string;
  acceptedAnnotation: AcceptedDeliveryAnnotation | null;
};

type ZipEntry = {
  name: string;
  crc32: number;
  compressedSize: bigint;
  uncompressedSize: bigint;
  localHeaderOffset: bigint;
  dosTime: number;
  dosDate: number;
};

function publicItem(item: DeliveryPackageItemEntity) {
  const annotation = item.acceptedAnnotationSnapshot as
    | AcceptedDeliveryAnnotation
    | null;
  return {
    id: item.id,
    submissionId: item.submissionId,
    fileName: item.fileName,
    objectKey: item.objectKey,
    ownerName: item.ownerName,
    teamName: item.teamName,
    finalScore: Number(item.finalScore),
    points: Number(item.points),
    sizeBytes: item.sizeBytes,
    annotation: annotation
      ? {
          available: true,
          schemaVersion: annotation.schemaVersion,
          policyVersion: annotation.policyVersion,
          promptVersion: annotation.promptVersion,
          reviewedAt: annotation.acceptance.acceptedAt,
        }
      : { available: false },
  };
}

function publicPackage(deliveryPackage: DeliveryPackageEntity) {
  return {
    id: deliveryPackage.id,
    name: deliveryPackage.name,
    status: deliveryPackage.status,
    assetCount: deliveryPackage.assetCount,
    totalSizeBytes: deliveryPackage.totalSizeBytes,
    createdByAccountId: deliveryPackage.createdByAccountId,
    createdByName: deliveryPackage.createdByName,
    createdAt: deliveryPackage.createdAt.getTime(),
    items: (deliveryPackage.items ?? []).map(publicItem),
  };
}

function publicArchiveTask(task: DeliveryArchiveTaskEntity) {
  const totalSize = Number(task.totalSizeBytes);
  const processedSize = Number(task.processedSizeBytes);
  const progressPercent =
    task.status === "completed"
      ? 100
      : totalSize <= 0
        ? task.processedAssetCount >= task.assetCount
          ? 100
          : 0
        : Math.max(
            0,
            Math.min(99, Math.round((processedSize / totalSize) * 100)),
          );
  return {
    id: task.id,
    packageId: task.packageId,
    format: task.format,
    status: task.status,
    assetCount: task.assetCount,
    processedAssetCount: task.processedAssetCount,
    totalSizeBytes: task.totalSizeBytes,
    processedSizeBytes: task.processedSizeBytes,
    progressPercent,
    archiveObjectKey: task.archiveObjectKey ?? undefined,
    archiveSizeBytes: task.archiveSizeBytes ?? undefined,
    fileName: task.fileName,
    failureMessage: task.failureMessage ?? undefined,
    attemptCount: task.attemptCount,
    requestedByAccountId: task.requestedByAccountId,
    requestedByName: task.requestedByName,
    startedAt: task.startedAt?.getTime(),
    finishedAt: task.finishedAt?.getTime(),
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
  };
}

function assertAdmin(actor: PublicUser): void {
  if (actor.status !== "active" || actor.role !== "admin") {
    throw new DeliveryFailure(
      "FORBIDDEN",
      "仅管理员可管理交付包",
      403,
    );
  }
}

function archiveTaskActor(task: DeliveryArchiveTaskEntity): PublicUser {
  return {
    id: task.requestedByAccountId,
    displayName: task.requestedByName,
    username: "delivery-archive-worker",
    role: "admin",
    status: "active",
    updatedAt: 0,
  };
}

function manifestCsvFor(deliveryPackage: DeliveryPackageEntity): string {
  const rows = [
    [
      "package_id",
      "package_name",
      "submission_id",
      "file_name",
      "object_key",
      "team_name",
      "owner_name",
      "final_score",
      "points",
      "size_bytes",
      "annotation_file",
      "annotation_schema_version",
      "annotation_policy_version",
      "annotation_prompt_version",
    ],
    ...(deliveryPackage.items ?? []).map((item) => {
      const annotation = item.acceptedAnnotationSnapshot as
        | AcceptedDeliveryAnnotation
        | null;
      return [
        deliveryPackage.id,
        deliveryPackage.name,
        item.submissionId,
        item.fileName,
        item.objectKey,
        item.teamName,
        item.ownerName,
        Number(item.finalScore).toFixed(1),
        Number(item.points).toFixed(2),
        item.sizeBytes,
        annotation ? annotationArchiveName(item) : "",
        annotation?.schemaVersion ?? "",
        annotation?.policyVersion ?? "",
        annotation?.promptVersion ?? "",
      ];
    }),
  ];
  return csvDocument(rows);
}

function tarNumber(value: number | bigint, length: number): string {
  const octal = value.toString(8);
  return `${octal.padStart(length - 1, "0")}\0`;
}

function tarHeader(name: string, size: number | bigint): Buffer {
  const header = Buffer.alloc(512, 0);
  if (Buffer.byteLength(name) > 100) {
    throw new DeliveryFailure(
      "ARCHIVE_PATH_TOO_LONG",
      "归档文件名过长",
      500,
    );
  }
  header.write(name, 0, 100, "utf8");
  header.write(tarNumber(0o644, 8), 100, 8, "ascii");
  header.write(tarNumber(0, 8), 108, 8, "ascii");
  header.write(tarNumber(0, 8), 116, 8, "ascii");
  header.write(tarNumber(size, 12), 124, 12, "ascii");
  header.write(tarNumber(Math.floor(Date.now() / 1_000), 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(tarNumber(checksum, 8), 148, 8, "ascii");
  return header;
}

function tarPadding(size: number | bigint): Buffer {
  const sizeBigInt = typeof size === "bigint" ? size : BigInt(size);
  const remainder = Number(sizeBigInt % 512n);
  return Buffer.alloc(remainder === 0 ? 0 : 512 - remainder);
}

function archiveAssetName(item: DeliveryPackageItemEntity): string {
  const extension = extname(item.fileName).toLowerCase() || ".mp4";
  return `assets/${item.submissionId}${extension}`;
}

function annotationArchiveName(item: DeliveryPackageItemEntity): string {
  const safeSubmissionId = item.submissionId.replace(
    /[^a-zA-Z0-9._-]/gu,
    "_",
  );
  return `annotations/${safeSubmissionId}.json`;
}

function annotationBuffer(item: DeliveryPackageItemEntity): Buffer | null {
  if (!item.acceptedAnnotationSnapshot) return null;
  return Buffer.from(
    `${JSON.stringify(item.acceptedAnnotationSnapshot, null, 2)}\n`,
    "utf8",
  );
}

function archiveContentType(format: DeliveryArchiveFormat): string {
  return format === "zip" ? "application/zip" : "application/x-tar";
}

function crc32Update(crc32: number, chunk: Buffer): number {
  let current = crc32 ^ 0xffffffff;
  for (const byte of chunk) {
    current = (current >>> 8) ^ ZIP_CRC32_TABLE[(current ^ byte) & 0xff]!;
  }
  return (current ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date = new Date()): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    dosTime:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    dosDate:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

function writeBigUInt64LE(buffer: Buffer, value: bigint, offset: number): void {
  buffer.writeBigUInt64LE(value, offset);
}

function zip64Extra(values: bigint[]): Buffer {
  if (values.length === 0) return Buffer.alloc(0);
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => {
    writeBigUInt64LE(extra, value, 4 + index * 8);
  });
  return extra;
}

function zipLocalHeader(
  name: string,
  expectedSize: bigint,
  timestamp = dosTimestamp(),
): Buffer {
  const nameBuffer = Buffer.from(name, "utf8");
  if (nameBuffer.length > ZIP_MAX_UINT16) {
    throw new DeliveryFailure(
      "ARCHIVE_PATH_TOO_LONG",
      "归档文件名过长",
      500,
    );
  }
  const needsZip64 = expectedSize > ZIP_MAX_UINT32;
  const extra = needsZip64 ? zip64Extra([expectedSize, expectedSize]) : Buffer.alloc(0);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(needsZip64 ? ZIP64_VERSION : ZIP_STORE_VERSION, 4);
  header.writeUInt16LE(ZIP_FLAG_DATA_DESCRIPTOR | ZIP_FLAG_UTF8, 6);
  header.writeUInt16LE(ZIP_METHOD_STORE, 8);
  header.writeUInt16LE(timestamp.dosTime, 10);
  header.writeUInt16LE(timestamp.dosDate, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(needsZip64 ? 0xffffffff : 0, 18);
  header.writeUInt32LE(needsZip64 ? 0xffffffff : 0, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return Buffer.concat([header, nameBuffer, extra]);
}

function zipDataDescriptor(entry: {
  crc32: number;
  compressedSize: bigint;
  uncompressedSize: bigint;
}): Buffer {
  const needsZip64 =
    entry.compressedSize > ZIP_MAX_UINT32 ||
    entry.uncompressedSize > ZIP_MAX_UINT32;
  const descriptor = Buffer.alloc(needsZip64 ? 24 : 16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(entry.crc32 >>> 0, 4);
  if (needsZip64) {
    writeBigUInt64LE(descriptor, entry.compressedSize, 8);
    writeBigUInt64LE(descriptor, entry.uncompressedSize, 16);
  } else {
    descriptor.writeUInt32LE(Number(entry.compressedSize), 8);
    descriptor.writeUInt32LE(Number(entry.uncompressedSize), 12);
  }
  return descriptor;
}

function zipCentralDirectoryHeader(entry: ZipEntry): Buffer {
  const nameBuffer = Buffer.from(entry.name, "utf8");
  const zip64Values: bigint[] = [];
  const needsSizeZip64 =
    entry.compressedSize > ZIP_MAX_UINT32 ||
    entry.uncompressedSize > ZIP_MAX_UINT32;
  const needsOffsetZip64 = entry.localHeaderOffset > ZIP_MAX_UINT32;
  if (needsSizeZip64) {
    zip64Values.push(entry.uncompressedSize, entry.compressedSize);
  }
  if (needsOffsetZip64) {
    zip64Values.push(entry.localHeaderOffset);
  }
  const extra = zip64Extra(zip64Values);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(needsSizeZip64 || needsOffsetZip64 ? ZIP64_VERSION : ZIP_STORE_VERSION, 4);
  header.writeUInt16LE(needsSizeZip64 || needsOffsetZip64 ? ZIP64_VERSION : ZIP_STORE_VERSION, 6);
  header.writeUInt16LE(ZIP_FLAG_DATA_DESCRIPTOR | ZIP_FLAG_UTF8, 8);
  header.writeUInt16LE(ZIP_METHOD_STORE, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc32 >>> 0, 16);
  header.writeUInt32LE(
    needsSizeZip64 ? 0xffffffff : Number(entry.compressedSize),
    20,
  );
  header.writeUInt32LE(
    needsSizeZip64 ? 0xffffffff : Number(entry.uncompressedSize),
    24,
  );
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(
    needsOffsetZip64 ? 0xffffffff : Number(entry.localHeaderOffset),
    42,
  );
  return Buffer.concat([header, nameBuffer, extra]);
}

function zip64EndOfCentralDirectory(
  entries: number,
  centralDirectorySize: bigint,
  centralDirectoryOffset: bigint,
): Buffer {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  writeBigUInt64LE(record, 44n, 4);
  record.writeUInt16LE(ZIP64_VERSION, 12);
  record.writeUInt16LE(ZIP64_VERSION, 14);
  record.writeUInt32LE(0, 16);
  record.writeUInt32LE(0, 20);
  writeBigUInt64LE(record, BigInt(entries), 24);
  writeBigUInt64LE(record, BigInt(entries), 32);
  writeBigUInt64LE(record, centralDirectorySize, 40);
  writeBigUInt64LE(record, centralDirectoryOffset, 48);
  return record;
}

function zip64EndOfCentralDirectoryLocator(
  zip64EndOffset: bigint,
): Buffer {
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  writeBigUInt64LE(locator, zip64EndOffset, 8);
  locator.writeUInt32LE(1, 16);
  return locator;
}

function zipEndOfCentralDirectory(
  entries: number,
  centralDirectorySize: bigint,
  centralDirectoryOffset: bigint,
  needsZip64: boolean,
): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(
    needsZip64 ? ZIP_MAX_UINT16 : Math.min(entries, ZIP_MAX_UINT16),
    8,
  );
  record.writeUInt16LE(
    needsZip64 ? ZIP_MAX_UINT16 : Math.min(entries, ZIP_MAX_UINT16),
    10,
  );
  record.writeUInt32LE(
    needsZip64 ? 0xffffffff : Number(centralDirectorySize),
    12,
  );
  record.writeUInt32LE(
    needsZip64 ? 0xffffffff : Number(centralDirectoryOffset),
    16,
  );
  record.writeUInt16LE(0, 20);
  return record;
}

@Injectable()
export class DeliveryPackagesService {
  constructor(
    @InjectRepository(DeliveryPackageEntity)
    private readonly packages: Repository<DeliveryPackageEntity>,
    @InjectRepository(DeliveryArchiveTaskEntity)
    private readonly archiveTasks: Repository<DeliveryArchiveTaskEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async list(actor: PublicUser) {
    assertAdmin(actor);
    const packages = await this.packages
      .createQueryBuilder("deliveryPackage")
      .leftJoinAndSelect("deliveryPackage.items", "item")
      .orderBy("deliveryPackage.createdAt", "DESC")
      .addOrderBy("item.teamName", "ASC")
      .addOrderBy("item.fileName", "ASC")
      .getMany();
    return packages.map(publicPackage);
  }

  async get(actor: PublicUser, id: string) {
    assertAdmin(actor);
    return publicPackage(await this.findPackage(id));
  }

  async create(actor: PublicUser, input: { name: string }) {
    assertAdmin(actor);
    const name = input.name.trim();
    if (!name) {
      throw new DeliveryFailure(
        "NAME_REQUIRED",
        "请填写交付包名称",
        400,
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const candidates = await this.loadCandidates(manager, true);
      if (candidates.length === 0) {
        throw new DeliveryFailure(
          "NO_DELIVERABLE_ASSETS",
          "当前没有可交付资产",
          409,
        );
      }
      const id = `PKG-${randomUUID()}`;
      const totalSizeBytes = candidates.reduce(
        (total, candidate) => total + BigInt(candidate.sizeBytes),
        0n,
      );
      const deliveryPackage = await manager
        .getRepository(DeliveryPackageEntity)
        .save({
          id,
          name,
          status: "ready",
          assetCount: candidates.length,
          totalSizeBytes: totalSizeBytes.toString(),
          createdByAccountId: actor.id,
          createdByName: actor.displayName,
        });
      await manager.getRepository(DeliveryPackageItemEntity).save(
        candidates.map(
          ({
            pointItem,
            submission,
            sizeBytes,
            finalScore,
            points,
            acceptedAnnotation,
          }) => ({
            id: `DPI-${randomUUID()}`,
            packageId: id,
            pointCycleItemId: pointItem.id,
            submissionId: submission.id,
            fileName: submission.originalFileName,
            objectKey: submission.objectKey,
            ownerName: pointItem.ownerName,
            teamName: pointItem.teamName,
            finalScore,
            points,
            sizeBytes,
            acceptedAnnotationSnapshot: acceptedAnnotation,
          }),
        ),
      );
      await this.audit.record(
        manager,
        actor,
        "delivery_package_create",
        { id, name },
        `创建交付包，包含 ${candidates.length} 条资产`,
        null,
        {
          assetCount: candidates.length,
          totalSizeBytes: totalSizeBytes.toString(),
        },
      );
      const saved = await manager
        .getRepository(DeliveryPackageEntity)
        .createQueryBuilder("deliveryPackage")
        .leftJoinAndSelect("deliveryPackage.items", "item")
        .where("deliveryPackage.id = :id", { id })
        .orderBy("item.teamName", "ASC")
        .addOrderBy("item.fileName", "ASC")
        .getOneOrFail();
      return publicPackage(saved);
    });
  }

  async manifestCsv(actor: PublicUser, id: string): Promise<string> {
    assertAdmin(actor);
    const deliveryPackage = await this.findPackage(id);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "delivery_manifest_download",
      { id: deliveryPackage.id, name: deliveryPackage.name },
      "下载交付包 CSV 资产清单",
      null,
      {
        assetCount: deliveryPackage.items?.length ?? 0,
      },
    );
    return manifestCsvFor(deliveryPackage);
  }

  async downloadLinks(actor: PublicUser, id: string) {
    assertAdmin(actor);
    const deliveryPackage = await this.findPackage(id);
    const links = await Promise.all(
      (deliveryPackage.items ?? []).map(async (item) => {
        const signed = await this.storage.presignDownloadObject({
          objectKey: item.objectKey,
          expiresInSeconds: DELIVERY_DOWNLOAD_URL_TTL_SECONDS,
        });
        return {
          packageItemId: item.id,
          submissionId: item.submissionId,
          fileName: item.fileName,
          objectKey: item.objectKey,
          sizeBytes: item.sizeBytes,
          url: signed.url,
          expiresAt: signed.expiresAt.getTime(),
        };
      }),
    );
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "storage_download_link",
      { id: deliveryPackage.id, name: deliveryPackage.name },
      "生成交付包资产短期下载链接",
      null,
      {
        assetCount: links.length,
        expiresInSeconds: DELIVERY_DOWNLOAD_URL_TTL_SECONDS,
        objectKeys: links.map((link) => link.objectKey),
      },
    );
    return {
      package: publicPackage(deliveryPackage),
      expiresInSeconds: DELIVERY_DOWNLOAD_URL_TTL_SECONDS,
      links,
    };
  }

  async listArchiveTasks(actor: PublicUser, id: string) {
    assertAdmin(actor);
    await this.findPackage(id);
    const tasks = await this.archiveTasks.find({
      where: { packageId: id },
      order: { createdAt: "DESC" },
      take: 20,
    });
    return tasks.map(publicArchiveTask);
  }

  async getArchiveTask(actor: PublicUser, id: string, taskId: string) {
    assertAdmin(actor);
    return publicArchiveTask(await this.findArchiveTask(id, taskId));
  }

  async createArchiveTask(
    actor: PublicUser,
    id: string,
    input: { format: DeliveryArchiveFormat },
  ) {
    assertAdmin(actor);
    const deliveryPackage = await this.findPackage(id);
    const taskId = `DAT-${randomUUID()}`;
    const format = input.format;
    const task = await this.dataSource.transaction(async (manager) => {
      const saved = await manager
        .getRepository(DeliveryArchiveTaskEntity)
        .save({
          id: taskId,
          packageId: deliveryPackage.id,
          format,
          status: "queued",
          assetCount: deliveryPackage.items?.length ?? 0,
          processedAssetCount: 0,
          totalSizeBytes: deliveryPackage.totalSizeBytes,
          processedSizeBytes: "0",
          fileName: `${deliveryPackage.id}-assets.${format}`,
          requestedByAccountId: actor.id,
          requestedByName: actor.displayName,
        });
      await this.audit.record(
        manager,
        actor,
        "delivery_archive_task_create",
        { id: saved.id, name: deliveryPackage.name },
        `准备交付包 ${format.toUpperCase()} 归档`,
        null,
        {
          packageId: deliveryPackage.id,
          format,
          assetCount: saved.assetCount,
          totalSizeBytes: saved.totalSizeBytes,
        },
      );
      return saved;
    });
    return publicArchiveTask(task);
  }

  async archiveTaskDownloadLink(
    actor: PublicUser,
    id: string,
    taskId: string,
  ) {
    assertAdmin(actor);
    const task = await this.findArchiveTask(id, taskId);
    if (task.status !== "completed" || !task.archiveObjectKey) {
      throw new DeliveryFailure(
        "ARCHIVE_NOT_READY",
        "归档尚未准备完成",
        409,
      );
    }
    const signed = await this.storage.presignDownloadObject({
      objectKey: task.archiveObjectKey,
      expiresInSeconds: DELIVERY_ARCHIVE_DOWNLOAD_URL_TTL_SECONDS,
    });
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "delivery_archive_task_download_link",
      { id: task.id, name: task.fileName },
      "生成交付包归档短期下载链接",
      null,
      {
        packageId: task.packageId,
        format: task.format,
        objectKey: task.archiveObjectKey,
        expiresInSeconds: DELIVERY_ARCHIVE_DOWNLOAD_URL_TTL_SECONDS,
      },
    );
    return {
      task: publicArchiveTask(task),
      url: signed.url,
      expiresAt: signed.expiresAt.getTime(),
      expiresInSeconds: DELIVERY_ARCHIVE_DOWNLOAD_URL_TTL_SECONDS,
    };
  }

  async archiveTar(actor: PublicUser, id: string) {
    assertAdmin(actor);
    const deliveryPackage = await this.findPackage(id);
    const items = deliveryPackage.items ?? [];
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "delivery_archive_download",
      { id: deliveryPackage.id, name: deliveryPackage.name },
      "下载交付包 TAR 归档",
      null,
      {
        format: "tar",
        assetCount: items.length,
        totalSizeBytes: deliveryPackage.totalSizeBytes,
      },
    );

    return {
      fileName: `${deliveryPackage.id}-assets.tar`,
      stream: this.createTarArchiveStream(deliveryPackage),
    };
  }

  async archiveZip(actor: PublicUser, id: string) {
    assertAdmin(actor);
    const deliveryPackage = await this.findPackage(id);
    const items = deliveryPackage.items ?? [];
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "delivery_archive_download",
      { id: deliveryPackage.id, name: deliveryPackage.name },
      "下载交付包 ZIP 归档",
      null,
      {
        format: "zip",
        assetCount: items.length,
        totalSizeBytes: deliveryPackage.totalSizeBytes,
      },
    );

    return {
      fileName: `${deliveryPackage.id}-assets.zip`,
      stream: this.createZipArchiveStream(deliveryPackage),
    };
  }

  async preview(actor: PublicUser) {
    assertAdmin(actor);
    const candidates = await this.loadCandidates();
    const totalSizeBytes = candidates.reduce(
      (total, candidate) => total + BigInt(candidate.sizeBytes),
      0n,
    );
    return {
      assetCount: candidates.length,
      totalSizeBytes: totalSizeBytes.toString(),
    };
  }

  private async findPackage(id: string): Promise<DeliveryPackageEntity> {
    const deliveryPackage = await this.packages
      .createQueryBuilder("deliveryPackage")
      .leftJoinAndSelect("deliveryPackage.items", "item")
      .where("deliveryPackage.id = :id", { id })
      .orderBy("item.teamName", "ASC")
      .addOrderBy("item.fileName", "ASC")
      .getOne();
    if (!deliveryPackage) {
      throw new DeliveryFailure("NOT_FOUND", "交付包不存在", 404);
    }
    return deliveryPackage;
  }

  private async findArchiveTask(
    packageId: string,
    taskId: string,
  ): Promise<DeliveryArchiveTaskEntity> {
    const task = await this.archiveTasks.findOneBy({ id: taskId, packageId });
    if (!task) {
      throw new DeliveryFailure("ARCHIVE_TASK_NOT_FOUND", "归档任务不存在", 404);
    }
    return task;
  }

  async claimPendingArchiveTasks(
    workerId: string,
    limit: number,
    now = new Date(),
  ): Promise<DeliveryArchiveClaim[]> {
    const requested = Math.max(
      0,
      Math.min(Math.floor(limit), DELIVERY_ARCHIVE_GLOBAL_CONCURRENCY),
    );
    if (requested === 0) return [];

    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        DELIVERY_ARCHIVE_CLAIM_LOCK_KEY,
      ]);
      const tasks = manager.getRepository(DeliveryArchiveTaskEntity);
      const activeCount = await tasks
        .createQueryBuilder("activeTask")
        .where("activeTask.status = :processing", { processing: "processing" })
        .andWhere("activeTask.leaseUntil > :now", { now })
        .getCount();
      const capacity = Math.min(
        requested,
        Math.max(0, DELIVERY_ARCHIVE_GLOBAL_CONCURRENCY - activeCount),
      );
      if (capacity === 0) return [];

      const candidates = await tasks
        .createQueryBuilder("archiveTask")
        .where(
          "(archiveTask.status = :queued OR (archiveTask.status = :processing AND (archiveTask.leaseUntil IS NULL OR archiveTask.leaseUntil <= :now)))",
          { queued: "queued", processing: "processing", now },
        )
        .orderBy("archiveTask.createdAt", "ASC")
        .addOrderBy("archiveTask.id", "ASC")
        .setLock("pessimistic_write")
        .setOnLocked("skip_locked")
        .take(capacity)
        .getMany();

      const claims: DeliveryArchiveClaim[] = [];
      for (const task of candidates) {
        const leaseToken = `DAL-${randomUUID()}`;
        const attemptCount = task.attemptCount + 1;
        await tasks
          .createQueryBuilder()
          .update(DeliveryArchiveTaskEntity)
          .set({
            status: "processing",
            attemptCount: () => '"attempt_count" + 1',
            leaseToken,
            leaseOwner: workerId,
            leaseUntil: new Date(now.getTime() + DELIVERY_ARCHIVE_LEASE_MS),
            processedAssetCount: 0,
            processedSizeBytes: "0",
            archiveObjectKey: null,
            archiveSizeBytes: null,
            failureMessage: null,
            startedAt: now,
            finishedAt: null,
          })
          .where("id = :id", { id: task.id })
          .execute();
        claims.push({
          taskId: task.id,
          leaseToken,
          leaseOwner: workerId,
          attemptCount,
        });
      }
      return claims;
    });
  }

  async processArchiveClaim(claim: DeliveryArchiveClaim): Promise<void> {
    const startedAt = new Date();
    const task = await this.archiveTasks.findOneBy({
      id: claim.taskId,
      status: "processing",
      leaseToken: claim.leaseToken,
      leaseOwner: claim.leaseOwner,
      leaseUntil: MoreThan(startedAt),
    });
    if (!task) return;

    let tempDir: string | null = null;
    let uploadedObjectKey: string | null = null;
    let publishedObject = false;
    let heartbeatRunning = false;
    let leaseLost = false;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void this.renewArchiveLease(claim)
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch(() => undefined)
        .finally(() => {
          heartbeatRunning = false;
        });
    }, DELIVERY_ARCHIVE_HEARTBEAT_MS);
    heartbeatTimer.unref();

    try {
      const deliveryPackage = await this.findPackage(task.packageId);
      tempDir = await mkdtemp(join(tmpdir(), "evdp-archive-"));
      const archivePath = join(tempDir, task.fileName);
      const archiveStream =
        task.format === "zip"
          ? this.createZipArchiveStream(deliveryPackage, claim)
          : this.createTarArchiveStream(deliveryPackage, claim);
      await pipeline(
        archiveStream,
        createWriteStream(archivePath, { flags: "wx" }),
      );
      if (leaseLost || !(await this.renewArchiveLease(claim))) {
        throw new DeliveryArchiveLeaseLostError(task.id);
      }
      const archiveStats = await stat(archivePath);
      const objectKey = `delivery-archives/${task.packageId}/${task.id}/${claim.leaseToken}.${task.format}`;
      uploadedObjectKey = objectKey;
      await this.storage.uploadObject({
        objectKey,
        sourcePath: archivePath,
        contentType: archiveContentType(task.format),
      });
      if (leaseLost || !(await this.renewArchiveLease(claim))) {
        throw new DeliveryArchiveLeaseLostError(task.id);
      }
      const completed = await this.completeArchiveClaim(
        claim,
        task,
        objectKey,
        String(archiveStats.size),
      );
      if (!completed) throw new DeliveryArchiveLeaseLostError(task.id);
      publishedObject = true;
    } catch (error) {
      if (!(error instanceof DeliveryArchiveLeaseLostError)) {
        await this.failOrRetryArchiveClaim(claim, task, error);
      }
    } finally {
      clearInterval(heartbeatTimer);
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      if (uploadedObjectKey && !publishedObject) {
        await this.deleteArchiveObjectUnlessPublished(
          task.id,
          uploadedObjectKey,
        );
      }
    }
  }

  private async deleteArchiveObjectUnlessPublished(
    taskId: string,
    objectKey: string,
  ): Promise<void> {
    const published = await this.archiveTasks.existsBy({
      id: taskId,
      status: "completed",
      archiveObjectKey: objectKey,
    });
    if (!published) await this.storage.deleteObject({ objectKey });
  }

  private async renewArchiveLease(
    claim: DeliveryArchiveClaim,
  ): Promise<boolean> {
    const now = new Date();
    const result = await this.archiveTasks.update(
      {
        id: claim.taskId,
        status: "processing",
        leaseToken: claim.leaseToken,
        leaseOwner: claim.leaseOwner,
        leaseUntil: MoreThan(now),
      },
      { leaseUntil: new Date(now.getTime() + DELIVERY_ARCHIVE_LEASE_MS) },
    );
    return result.affected === 1;
  }

  private async completeArchiveClaim(
    claim: DeliveryArchiveClaim,
    task: DeliveryArchiveTaskEntity,
    objectKey: string,
    archiveSizeBytes: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const result = await manager.getRepository(DeliveryArchiveTaskEntity).update(
        {
          id: claim.taskId,
          status: "processing",
          leaseToken: claim.leaseToken,
          leaseOwner: claim.leaseOwner,
          leaseUntil: MoreThan(now),
        },
        {
          status: "completed",
          processedAssetCount: task.assetCount,
          processedSizeBytes: task.totalSizeBytes,
          archiveObjectKey: objectKey,
          archiveSizeBytes,
          failureMessage: null,
          leaseToken: null,
          leaseOwner: null,
          leaseUntil: null,
          finishedAt: new Date(),
        },
      );
      if (result.affected !== 1) return false;
      await this.audit.record(
        manager,
        archiveTaskActor(task),
        "delivery_archive_task_complete",
        { id: task.id, name: task.fileName },
        "交付包归档准备完成",
        null,
        {
          packageId: task.packageId,
          format: task.format,
          objectKey,
          archiveSizeBytes,
          attemptCount: claim.attemptCount,
        },
      );
      return true;
    });
  }

  private async failOrRetryArchiveClaim(
    claim: DeliveryArchiveClaim,
    task: DeliveryArchiveTaskEntity,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : "交付包归档准备失败";
    const shouldRetry = claim.attemptCount < DELIVERY_ARCHIVE_MAX_ATTEMPTS;
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const result = await manager.getRepository(DeliveryArchiveTaskEntity).update(
        {
          id: claim.taskId,
          status: "processing",
          leaseToken: claim.leaseToken,
          leaseOwner: claim.leaseOwner,
          leaseUntil: MoreThan(now),
        },
        {
          status: shouldRetry ? "queued" : "failed",
          processedAssetCount: 0,
          processedSizeBytes: "0",
          failureMessage: message,
          leaseToken: null,
          leaseOwner: null,
          leaseUntil: null,
          finishedAt: shouldRetry ? null : new Date(),
        },
      );
      if (result.affected !== 1 || shouldRetry) return;
      await this.audit.record(
        manager,
        archiveTaskActor(task),
        "delivery_archive_task_fail",
        { id: task.id, name: task.fileName },
        "交付包归档准备失败",
        null,
        {
          packageId: task.packageId,
          format: task.format,
          failureMessage: message,
          attemptCount: claim.attemptCount,
        },
      );
    });
  }

  private createTarArchiveStream(
    deliveryPackage: DeliveryPackageEntity,
    claim?: DeliveryArchiveClaim,
  ) {
    const manifest = Buffer.from(manifestCsvFor(deliveryPackage), "utf8");
    const items = deliveryPackage.items ?? [];
    const storage = this.storage;
    const reportProgress = async (
      processedAssetCount: number,
      processedSizeBytes: bigint,
    ) => {
      if (!claim) return;
      await this.updateArchiveProgress(
        claim,
        processedAssetCount,
        processedSizeBytes,
      );
    };

    async function* chunks(): AsyncGenerator<Buffer> {
      let processedSizeBytes = 0n;
      yield tarHeader("manifest.csv", manifest.length);
      yield manifest;
      yield tarPadding(BigInt(manifest.length));

      for (const [index, item] of items.entries()) {
        const annotation = annotationBuffer(item);
        if (annotation) {
          yield tarHeader(annotationArchiveName(item), annotation.length);
          yield annotation;
          yield tarPadding(BigInt(annotation.length));
        }
        const size = BigInt(item.sizeBytes);
        yield tarHeader(archiveAssetName(item), size);
        const source = await storage.readObject({ objectKey: item.objectKey });
        for await (const chunk of source as AsyncIterable<Buffer | string>) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        }
        yield tarPadding(size);
        processedSizeBytes += size;
        await reportProgress(index + 1, processedSizeBytes);
      }
      yield Buffer.alloc(1024, 0);
    }

    return Readable.from(chunks());
  }

  private createZipArchiveStream(
    deliveryPackage: DeliveryPackageEntity,
    claim?: DeliveryArchiveClaim,
  ) {
    const manifest = Buffer.from(manifestCsvFor(deliveryPackage), "utf8");
    const items = deliveryPackage.items ?? [];
    const storage = this.storage;
    const reportProgress = async (
      processedAssetCount: number,
      processedSizeBytes: bigint,
    ) => {
      if (!claim) return;
      await this.updateArchiveProgress(
        claim,
        processedAssetCount,
        processedSizeBytes,
      );
    };

    async function* chunks(): AsyncGenerator<Buffer> {
      const entries: ZipEntry[] = [];
      let offset = 0n;
      let processedSizeBytes = 0n;

      async function* addEntry(
        name: string,
        expectedSize: bigint,
        source: AsyncIterable<Buffer | string>,
      ): AsyncGenerator<Buffer> {
        const timestamp = dosTimestamp();
        const localHeaderOffset = offset;
        const localHeader = zipLocalHeader(name, expectedSize, timestamp);
        offset += BigInt(localHeader.length);
        yield localHeader;

        let crc32 = 0;
        let actualSize = 0n;
        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          crc32 = crc32Update(crc32, buffer);
          actualSize += BigInt(buffer.length);
          offset += BigInt(buffer.length);
          yield buffer;
        }

        const entry = {
          name,
          crc32,
          compressedSize: actualSize,
          uncompressedSize: actualSize,
          localHeaderOffset,
          dosTime: timestamp.dosTime,
          dosDate: timestamp.dosDate,
        };
        const descriptor = zipDataDescriptor(entry);
        offset += BigInt(descriptor.length);
        yield descriptor;
        entries.push(entry);
      }

      yield* addEntry(
        "manifest.csv",
        BigInt(manifest.length),
        Readable.from([manifest]),
      );

      for (const [index, item] of items.entries()) {
        const annotation = annotationBuffer(item);
        if (annotation) {
          yield* addEntry(
            annotationArchiveName(item),
            BigInt(annotation.length),
            Readable.from([annotation]),
          );
        }
        const source = await storage.readObject({ objectKey: item.objectKey });
        const expectedSize = BigInt(item.sizeBytes);
        yield* addEntry(
          archiveAssetName(item),
          expectedSize,
          source as AsyncIterable<Buffer | string>,
        );
        processedSizeBytes += expectedSize;
        await reportProgress(index + 1, processedSizeBytes);
      }

      const centralDirectoryOffset = offset;
      for (const entry of entries) {
        const header = zipCentralDirectoryHeader(entry);
        offset += BigInt(header.length);
        yield header;
      }
      const centralDirectorySize = offset - centralDirectoryOffset;
      const needsZip64 =
        entries.length > ZIP_MAX_UINT16 ||
        centralDirectorySize > ZIP_MAX_UINT32 ||
        centralDirectoryOffset > ZIP_MAX_UINT32 ||
        entries.some(
          (entry) =>
            entry.compressedSize > ZIP_MAX_UINT32 ||
            entry.uncompressedSize > ZIP_MAX_UINT32 ||
            entry.localHeaderOffset > ZIP_MAX_UINT32,
        );
      if (needsZip64) {
        const zip64Offset = offset;
        const zip64 = zip64EndOfCentralDirectory(
          entries.length,
          centralDirectorySize,
          centralDirectoryOffset,
        );
        offset += BigInt(zip64.length);
        yield zip64;
        const locator = zip64EndOfCentralDirectoryLocator(zip64Offset);
        offset += BigInt(locator.length);
        yield locator;
      }
      yield zipEndOfCentralDirectory(
        entries.length,
        centralDirectorySize,
        centralDirectoryOffset,
        needsZip64,
      );
    }

    return Readable.from(chunks());
  }

  private async updateArchiveProgress(
    claim: DeliveryArchiveClaim,
    processedAssetCount: number,
    processedSizeBytes: bigint,
  ): Promise<void> {
    const now = new Date();
    const result = await this.archiveTasks.update(
      {
        id: claim.taskId,
        status: "processing",
        leaseToken: claim.leaseToken,
        leaseOwner: claim.leaseOwner,
        leaseUntil: MoreThan(now),
      },
      {
        processedAssetCount,
        processedSizeBytes: processedSizeBytes.toString(),
        leaseUntil: new Date(now.getTime() + DELIVERY_ARCHIVE_LEASE_MS),
      },
    );
    if (result.affected !== 1) {
      throw new DeliveryArchiveLeaseLostError(claim.taskId);
    }
  }

  private async loadCandidates(
    manager: EntityManager = this.dataSource.manager,
    lock = false,
  ): Promise<Candidate[]> {
    let lockedIds: string[] | null = null;
    if (lock) {
      const ids = await this.candidateIdQuery(manager).getRawMany<{
        point_item_id: string;
      }>();
      lockedIds = ids.map((row) => row.point_item_id);
      if (lockedIds.length === 0) return [];
      await manager
        .getRepository(PointCycleItemEntity)
        .createQueryBuilder("pointItem")
        .setLock("pessimistic_write")
        .where("pointItem.id IN (:...ids)", { ids: lockedIds })
        .getMany();
    }
    const query = manager
      .getRepository(PointCycleItemEntity)
      .createQueryBuilder("pointItem")
      .innerJoinAndSelect("pointItem.submission", "submission")
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoin(
        DeliveryPackageItemEntity,
        "deliveryItem",
        "deliveryItem.submissionId = pointItem.submissionId",
      )
      .where("deliveryItem.id IS NULL")
      .andWhere("submission.uploadStatus = :uploaded", {
        uploaded: "uploaded",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .orderBy("pointItem.teamName", "ASC")
      .addOrderBy("pointItem.fileName", "ASC");
    if (lockedIds) {
      query.andWhere("pointItem.id IN (:...lockedIds)", { lockedIds });
    }
    const pointItems = await query.getMany();
    const latestAdjustments = await loadLatestPointCycleAdjustments(
      manager,
      pointItems.map((pointItem) => pointItem.id),
    );
    const submissionIds = pointItems.flatMap((pointItem) =>
      pointItem.submission ? [pointItem.submission.id] : [],
    );
    const verifiedRuns =
      submissionIds.length === 0
        ? []
        : await manager.getRepository(AnnotationRunEntity).find({
            where: {
              submissionId: In(submissionIds),
              publicationStatus: In(["human_verified", "auto_accepted"]),
            },
            order: { createdAt: "DESC", id: "DESC" },
          });
    const latestVerifiedRun = new Map<string, AnnotationRunEntity>();
    for (const run of verifiedRuns) {
      if (!latestVerifiedRun.has(run.submissionId)) {
        latestVerifiedRun.set(run.submissionId, run);
      }
    }
    const verifiedRunIds = [...latestVerifiedRun.values()].map((run) => run.id);
    const verifiedReviews =
      verifiedRunIds.length === 0
        ? []
        : await manager.getRepository(AnnotationReviewEntity).find({
            where: { annotationRunId: In(verifiedRunIds) },
            order: { revision: "DESC" },
          });
    const latestVerifiedReview = new Map<string, AnnotationReviewEntity>();
    for (const review of verifiedReviews) {
      if (!latestVerifiedReview.has(review.annotationRunId)) {
        latestVerifiedReview.set(review.annotationRunId, review);
      }
    }
    return pointItems.flatMap((pointItem) => {
      const submission = pointItem.submission;
      if (!submission) return [];
      const adjustment = latestAdjustments.get(pointItem.id);
      const settlementRatio = Number(
        adjustment?.nextSettlementRatio ?? pointItem.settlementRatio,
      );
      if (!Number.isFinite(settlementRatio) || settlementRatio <= 0) return [];
      const metadata = (
        submission as SubmissionEntity & {
          metadata?: MediaMetadataEntity | null;
        }
      ).metadata;
      const annotationRun = latestVerifiedRun.get(submission.id);
      return [
        {
          pointItem,
          submission,
          sizeBytes: metadata?.sizeBytes ?? submission.expectedSizeBytes,
          finalScore: adjustment?.nextFinalScore ?? pointItem.finalScore,
          points: adjustment?.nextPoints ?? pointItem.points,
          acceptedAnnotation:
            acceptedAnnotationRun(
              annotationRun,
              annotationRun
                ? latestVerifiedReview.get(annotationRun.id)
                : undefined,
            ),
        },
      ];
    });
  }

  private candidateIdQuery(manager: EntityManager) {
    return manager
      .getRepository(PointCycleItemEntity)
      .createQueryBuilder("pointItem")
      .select("pointItem.id", "point_item_id")
      .innerJoin("pointItem.submission", "submission")
      .leftJoin(
        DeliveryPackageItemEntity,
        "deliveryItem",
        "deliveryItem.submissionId = pointItem.submissionId",
      )
      .where("deliveryItem.id IS NULL")
      .andWhere("submission.uploadStatus = :uploaded", {
        uploaded: "uploaded",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .orderBy("pointItem.teamName", "ASC")
      .addOrderBy("pointItem.fileName", "ASC");
  }
}
