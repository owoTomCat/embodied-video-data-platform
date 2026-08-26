import "reflect-metadata";

import { DataSource } from "typeorm";

import { AuditLogEntity } from "./entities/audit-log.entity.js";
import { CollectionTaskEntity } from "./entities/collection-task.entity.js";
import { DeliveryArchiveTaskEntity } from "./entities/delivery-archive-task.entity.js";
import { DeliveryPackageEntity } from "./entities/delivery-package.entity.js";
import { DeliveryPackageItemEntity } from "./entities/delivery-package-item.entity.js";
import { JobOutboxEntity } from "./entities/job-outbox.entity.js";
import { LabelSetVersionEntity } from "./entities/label-set-version.entity.js";
import { MediaMetadataEntity } from "./entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "./entities/media-segment.entity.js";
import { PointCycleAdjustmentEntity } from "./entities/point-cycle-adjustment.entity.js";
import { PointCycleEntity } from "./entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "./entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "./entities/point-rule-version.entity.js";
import { PublicSiteSnapshotEntity } from "./entities/public-site-snapshot.entity.js";
import { ScarcityConfigEntity } from "./entities/scarcity-config.entity.js";
import { QualityRuleVersionEntity } from "./entities/quality-rule-version.entity.js";
import { SessionEntity } from "./entities/session.entity.js";
import { SubmissionDuplicateCandidateEntity } from "./entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "./entities/submission.entity.js";
import { TeamEntity } from "./entities/team.entity.js";
import { UserEntity } from "./entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "./entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "./entities/video-quality-result.entity.js";
import { WorkerHeartbeatEntity } from "./entities/worker-heartbeat.entity.js";
import { AiQuality2026081200003 } from "./migrations/202608120003-ai-quality.js";
import { AddAccountPhone2026082600001 } from "./migrations/202608260001-add-account-phone.js";
import { AddTaskTypeToCollectionTasks2026083000001 } from "./migrations/202608300001-add-task-type.js";
import { AiQualityProgressStuck2026081700001 } from "./migrations/202608170001-ai-quality-progress-stuck.js";
import { CollectionTasks2026082400001 } from "./migrations/202608240001-collection-tasks.js";
import { ScarcityConfigAndMediaScene2026081900001 } from "./migrations/202608190001-scarcity-config-and-media-scene.js";
import { DeliveryPackages2026081300006 } from "./migrations/202608130006-delivery-packages.js";
import { DeliveryArchiveTasks2026081300020 } from "./migrations/202608130020-delivery-archive-tasks.js";
import { HlsPreviewAssets2026081300021 } from "./migrations/202608130021-hls-preview-assets.js";
import { Identity2026080700001 } from "./migrations/202608070001-identity.js";
import { LabelSetVersions2026081300012 } from "./migrations/202608130012-label-set-versions.js";
import { ManualQualityReview2026081300004 } from "./migrations/202608130004-manual-quality-review.js";
import { MediaPreviewAssets2026081300008 } from "./migrations/202608130008-media-preview-assets.js";
import { PointCycleAdjustments2026081300007 } from "./migrations/202608130007-point-cycle-adjustments.js";
import { PointCycles2026081300005 } from "./migrations/202608130005-point-cycles.js";
import { PointRuleVersions2026081300013 } from "./migrations/202608130013-point-rule-versions.js";
import { PublicSiteSnapshots2026081300015 } from "./migrations/202608130015-public-site-snapshots.js";
import { QualityRuleVersions2026081300011 } from "./migrations/202608130011-quality-rule-versions.js";
import { RuleSnapshots2026081300014 } from "./migrations/202608130014-rule-snapshots.js";
import { SensitiveVideoQuarantine2026081300017 } from "./migrations/202608130017-sensitive-video-quarantine.js";
import { SubmissionDuplicateCandidates2026081300022 } from "./migrations/202608130022-submission-duplicate-candidates.js";
import { RuleRuntimeSnapshots2026081300023 } from "./migrations/202608130023-rule-runtime-snapshots.js";
import { DeliveryArchiveTaskLeases2026081300024 } from "./migrations/202608130024-delivery-archive-task-leases.js";
import { SubmissionStorageRecovery2026081300025 } from "./migrations/202608130025-submission-storage-recovery.js";
import { UploadCompletingStatus2026081300026 } from "./migrations/202608130026-upload-completing-status.js";
import { ObjectStorageGovernance2026081300018 } from "./migrations/202608130018-object-storage-governance.js";
import { UploadAuthorization2026081300016 } from "./migrations/202608130016-upload-authorization.js";
import { VideoIngestion2026080700002 } from "./migrations/202608070002-video-ingestion.js";
import { WorkerCurrentTaskStartedAt2026081300010 } from "./migrations/202608130010-worker-current-task-started-at.js";
import { WorkerHeartbeats2026081300009 } from "./migrations/202608130009-worker-heartbeats.js";
import { WorkerTaskMetrics2026081300019 } from "./migrations/202608130019-worker-task-metrics.js";

export const identityEntities = [
  TeamEntity,
  UserEntity,
  SessionEntity,
  AuditLogEntity,
  SubmissionEntity,
  SubmissionDuplicateCandidateEntity,
  MediaMetadataEntity,
  MediaSegmentEntity,
  JobOutboxEntity,
  LabelSetVersionEntity,
  VideoQualityPromptVersionEntity,
  VideoQualityResultEntity,
  WorkerHeartbeatEntity,
  QualityRuleVersionEntity,
  PointCycleEntity,
  PointCycleItemEntity,
  PointCycleAdjustmentEntity,
  PointRuleVersionEntity,
  DeliveryPackageEntity,
  DeliveryPackageItemEntity,
  DeliveryArchiveTaskEntity,
  PublicSiteSnapshotEntity,
  ScarcityConfigEntity,
  CollectionTaskEntity,
];

export function createDataSource(
  databaseUrl = process.env.DATABASE_URL,
): DataSource {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    entities: identityEntities,
    migrations: [
      Identity2026080700001,
      VideoIngestion2026080700002,
      AiQuality2026081200003,
      ManualQualityReview2026081300004,
      PointCycles2026081300005,
      DeliveryPackages2026081300006,
      PointCycleAdjustments2026081300007,
      MediaPreviewAssets2026081300008,
      WorkerHeartbeats2026081300009,
      WorkerCurrentTaskStartedAt2026081300010,
      QualityRuleVersions2026081300011,
      LabelSetVersions2026081300012,
      PointRuleVersions2026081300013,
      RuleSnapshots2026081300014,
      PublicSiteSnapshots2026081300015,
      UploadAuthorization2026081300016,
      SensitiveVideoQuarantine2026081300017,
      ObjectStorageGovernance2026081300018,
      WorkerTaskMetrics2026081300019,
      DeliveryArchiveTasks2026081300020,
      HlsPreviewAssets2026081300021,
      SubmissionDuplicateCandidates2026081300022,
      RuleRuntimeSnapshots2026081300023,
      DeliveryArchiveTaskLeases2026081300024,
      SubmissionStorageRecovery2026081300025,
      UploadCompletingStatus2026081300026,
      AiQualityProgressStuck2026081700001,
      ScarcityConfigAndMediaScene2026081900001,
      CollectionTasks2026082400001,
      AddAccountPhone2026082600001,
      AddTaskTypeToCollectionTasks2026083000001,
    ],
    synchronize: false,
    logging: false,
  });
}
