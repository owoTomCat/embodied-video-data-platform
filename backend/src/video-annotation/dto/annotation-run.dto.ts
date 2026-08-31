import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const correctionTargets = [
  "scene",
  "task_segment",
  "interaction",
  "object",
  "tool",
  "completion",
  "outcome",
  "failure_recovery",
  "evidence",
  "annotation",
] as const;

export class AnnotationRunReasonDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  reason!: string;
}

export class DiscardAnnotationRunDto {
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;

  @IsIn([
    "version_replaced",
    "configuration_error",
    "operator_cancelled",
  ])
  reasonCode!:
    | "version_replaced"
    | "configuration_error"
    | "operator_cancelled";

  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  reason!: string;
}

export class AnnotationCorrectionDto {
  @IsIn(correctionTargets)
  targetType!: (typeof correctionTargets)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  targetId!: string;

  @IsString()
  @Matches(/^[a-z_]+(?:\[[0-9]+\])?(?:\.[a-z_]+(?:\[[0-9]+\])?)*$/u)
  @MaxLength(300)
  fieldPath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  comment?: string;
}

export class ReviewAnnotationRunDto {
  @IsInt()
  @Min(0)
  expectedReviewRevision!: number;

  @IsIn([
    "accepted_unchanged",
    "accepted_corrected",
    "rejected",
    "unable_to_judge",
  ])
  disposition!:
    | "accepted_unchanged"
    | "accepted_corrected"
    | "rejected"
    | "unable_to_judge";

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  reviewedFields!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  reasonCodes!: string[];

  @IsInt()
  @Min(0)
  @Max(86_400_000)
  reviewDurationMs!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  reason!: string;

  @IsOptional()
  @IsObject()
  correctedResult?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AnnotationCorrectionDto)
  corrections?: AnnotationCorrectionDto[];
}
