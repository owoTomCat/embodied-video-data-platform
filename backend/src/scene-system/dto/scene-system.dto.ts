import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSceneDto {
  /** 场景名称（如 厨房 / 工位 / 装配区） */
  @IsString()
  @MaxLength(80)
  name!: string;

  /** 计费大类 key（scene_category_pricing.category_key） */
  @IsString()
  @MaxLength(64)
  categoryKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;
}

export class UpdateSceneDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
