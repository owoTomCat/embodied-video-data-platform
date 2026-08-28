import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class UpdatePublicSiteConfigDto {
  /** 商务联系文案（唯一可手工配置项） */
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  ctaCopy!: string;

  /**
   * 兼容旧客户端：主推场景由后台按最高频场景自动生成，
   * 不再接受手工填写；保留可选字段避免破坏旧调用方。
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  primarySceneName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  primarySceneDescription?: string;
}
