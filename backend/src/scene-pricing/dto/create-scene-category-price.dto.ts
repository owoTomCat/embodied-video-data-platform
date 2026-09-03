import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateSceneCategoryPriceDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsNumber()
  @Min(20)
  @Max(40)
  pricePerHour!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;
}
