import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateSceneCategoryPriceDto {
  /** 每小时单价（元/小时），范围 [20, 40] */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(40)
  pricePerHour!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;
}
