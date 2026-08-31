import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export const ANNOTATION_OPERATION_VIEWS = [
  "pending_review",
  "audit_pending",
  "auto_published",
  "execution_failed",
  "in_progress",
  "resolved",
  "all",
] as const;

export type AnnotationOperationsView = (typeof ANNOTATION_OPERATION_VIEWS)[number];

export class AnnotationOperationsQueryDto {
  @IsOptional()
  @IsIn(ANNOTATION_OPERATION_VIEWS)
  view?: AnnotationOperationsView;

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

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return value;
  })
  @IsBoolean()
  includeSummary?: boolean;
}
