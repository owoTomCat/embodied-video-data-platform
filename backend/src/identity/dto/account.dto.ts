import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import type {
  UserRole,
  UserStatus,
} from "../../database/entities/user.entity.js";

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password!: string;

  @IsIn(["admin", "leader", "collector"])
  role!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  teamId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^1[3-9]\d{9}$/, { message: "手机号格式不正确" })
  phone?: string;
}

export class UpdateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  username!: string;

  @IsIn(["admin", "leader", "collector"])
  role!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  teamId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^1[3-9]\d{9}$/, { message: "手机号格式不正确" })
  phone?: string;
}

export class UpdateOwnAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^1[3-9]\d{9}$/, { message: "手机号格式不正确" })
  phone?: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password!: string;
}

export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword!: string;
}

export class SetAccountStatusDto {
  @IsIn(["active", "disabled"])
  status!: UserStatus;
}
