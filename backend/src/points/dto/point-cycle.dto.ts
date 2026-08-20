import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreatePointCycleDto {
  @IsOptional()
  @IsDateString()
  businessDate?: string;
}

export class AdjustPointCycleItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  reason!: string;

  /** 调整后的最终评分（可选，不传则保持当前值） */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  nextFinalScore?: number;

  /** 调整后的无效时长毫秒数（可选，不传则保持当前值；会影响有效时长与积分） */
  @IsOptional()
  @IsInt()
  @Min(0)
  nextInvalidDurationMs?: number;
}
