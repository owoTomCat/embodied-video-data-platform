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

const TASK_TYPES = ["generic", "preset", "custom"] as const;

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

  /** 任务类型：generic=通用任务 / preset=预设场景 / custom=自定义；缺省按 custom */
  @IsOptional()
  @IsIn(TASK_TYPES, { message: "任务类型不合法" })
  taskType?: (typeof TASK_TYPES)[number];

  @IsString()
  @MaxLength(MAX_RAW_REQUIREMENTS_LENGTH, {
    message: "任务要求不能超过 20000 个字符",
  })
  rawRequirements!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  pricePointsPerMinute?: number | null;
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
  pricePointsPerMinute?: number | null;
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
