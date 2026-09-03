import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const MAX_PHOTOS = 5;

export class PhotoRefDto {
  @IsString()
  @MaxLength(512)
  objectKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

/** 数采创建自己的场景库（从三层体系选一级大类 + 二级子场景） */
export class CreateCollectorLibraryDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(64)
  categoryKey!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  subSceneIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  /** 建库时上传的环境照片（MinIO 对象），首张作为场景库卡片封面 + 供 AI 识别生成任务卡 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PhotoRefDto)
  photoRefs?: PhotoRefDto[];
}

/** 拍照指导：用于生成任务卡的请求（环境照片已通过预签名上传到 MinIO） */
export class GenerateGuideTaskDto {
  @IsString()
  @MaxLength(64)
  sceneLibraryId!: string;

  @IsArray()
  @ArrayMaxSize(MAX_PHOTOS)
  @ValidateNested({ each: true })
  @Type(() => PhotoRefDto)
  photoRefs!: PhotoRefDto[];
}

/** 与模型输出 / 数据库存储一致使用 snake_case 字段名。 */
export class TaskCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TargetObjectDto)
  target_objects!: TargetObjectDto[];

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  steps!: string[];

  @IsString()
  @MaxLength(500)
  end_condition!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  success_criteria!: string[];

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  fail_criteria!: string[];
}

export class TargetObjectDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  action?: string;
}

/** 数采编辑并提交任务卡（进入人工审核） */
export class SubmitEditedCardDto {
  @IsString()
  @MaxLength(120)
  sceneName!: string;

  @Type(() => TaskCardDto)
  @ValidateNested()
  card!: TaskCardDto;
}

/** 管理员审核任务卡 */
export class ReviewGuideTaskDto {
  @IsIn(["approved", "rejected"])
  decision!: "approved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  comment?: string;

  /** 审核时用管理员确认后的卡片覆盖（可选，缺省沿用现有 card） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  successCriteria?: string[];
}
