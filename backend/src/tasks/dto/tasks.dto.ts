import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";

import type { CollectionTaskStatus } from "../../database/entities/collection-task.entity.js";

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_SCENE_NAME_LENGTH = 120;
const MAX_RAW_REQUIREMENTS_LENGTH = 20_000;
const MAX_REQUIREMENT_ITEMS = 100;

// 任务类型：generic（通用，系统仅保留一条）/ scene_type（场景型补量）。
const TASK_TYPES = ["generic", "scene_type"] as const;

/** 场景型任务目标（按场景）：提供已有 sceneId，或提供新场景 sceneName（保存时新建场景+标签） */
export class SceneTargetDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sceneId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sceneName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  targetDurationSeconds!: number;
}

export class CreateTaskDto {
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH, { message: "任务标题不能超过 120 个字符" })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH, {
    message: "任务说明不能超过 20000 个字符",
  })
  description?: string;

  @IsString()
  @MaxLength(MAX_SCENE_NAME_LENGTH, { message: "场景名称不能超过 120 个字符" })
  sceneName!: string;

  /** 关联场景库场景 id（已废弃：preset 任务类型不再新建，保留字段兼容历史） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sceneLibraryId?: string | null;

  /** 任务类型：generic=通用 / scene_type=场景型（补量） / custom=自定义（preset 已废弃） */
  @IsOptional()
  @IsIn(TASK_TYPES, { message: "任务类型不合法" })
  taskType?: (typeof TASK_TYPES)[number];

  /** 场景型任务绑定的计费大类（category_key） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryKey?: string;

  /** 场景型任务目标（按场景）；scene_type 使用 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SceneTargetDto)
  sceneTargets?: SceneTargetDto[];

  @IsString()
  @MaxLength(MAX_RAW_REQUIREMENTS_LENGTH, {
    message: "任务要求不能超过 20000 个字符",
  })
  rawRequirements!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  pricePerHour?: number | null;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH, { message: "任务标题不能超过 120 个字符" })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH, {
    message: "任务说明不能超过 20000 个字符",
  })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCENE_NAME_LENGTH, { message: "场景名称不能超过 120 个字符" })
  sceneName?: string;

  @IsOptional()
  @IsIn(TASK_TYPES, { message: "任务类型不合法" })
  taskType?: (typeof TASK_TYPES)[number];

  /** 场景型任务绑定的计费大类（category_key） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryKey?: string;

  /** 场景型任务目标（按场景）；scene_type 使用 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SceneTargetDto)
  sceneTargets?: SceneTargetDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RAW_REQUIREMENTS_LENGTH, {
    message: "任务要求不能超过 20000 个字符",
  })
  rawRequirements?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  pricePerHour?: number | null;
}

export class NormalizedRequirementItemDto {
  @IsIn(["hard", "soft"])
  type!: "hard" | "soft";

  @IsString()
  @MaxLength(2_000, { message: "单条要求不能超过 2000 个字符" })
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  rationale?: string;
}

export class ConfirmNormalizedRequirementsDto {
  @IsString()
  @MaxLength(2_000, { message: "场景描述不能超过 2000 个字符" })
  scene_description!: string;

  @IsArray()
  @ArrayMaxSize(MAX_REQUIREMENT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => NormalizedRequirementItemDto)
  requirements!: NormalizedRequirementItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2_000, { each: true })
  quality_notes?: string[];
}

export class TaskQueryDto {
  @IsOptional()
  @IsIn(["all", "draft", "published", "paused", "closed"])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export type TaskManageStatusFilter =
  | CollectionTaskStatus
  | "all";
