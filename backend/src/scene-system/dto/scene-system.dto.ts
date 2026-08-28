import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateSceneClassificationDto {
  /** 一级编码：F01 家庭 / O01 办公室 / W01 工厂 / G01 通用 */
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  level1Code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  level2Name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;
}

export class UpdateSceneClassificationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  level2Name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateSceneLibraryDto {
  /** 场景名称（如「采集员A家」） */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** 场景类别（一级）：family / office / factory / generic */
  @IsString()
  categoryKey!: string;

  /** 包含的子场景：scene_classification.id 列表 */
  @IsArray()
  @IsString({ each: true })
  subSceneIds: string[] = [];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;
}

export class UpdateSceneLibraryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  categoryKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subSceneIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
