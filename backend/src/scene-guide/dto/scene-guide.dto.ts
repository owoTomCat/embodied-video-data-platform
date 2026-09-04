import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
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

/** 数采创建自己的场景库（强制单场景 + 可选挂大场景任务） */
export class CreateCollectorLibraryDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(64)
  sceneId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  collectionTaskId?: string | null;

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
