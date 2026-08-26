import type { UserRole, UserStatus } from "../database/entities/user.entity.js";

export type PublicUser = {
  id: string;
  displayName: string;
  username: string;
  role: UserRole;
  teamId?: string;
  phone?: string;
  status: UserStatus;
  updatedAt: number;
};

export type AuthFailureCode =
  | "INVALID_CREDENTIALS"
  | "DISABLED"
  | "LOCKED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN";

export class AuthFailure extends Error {
  constructor(
    readonly code: AuthFailureCode,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthFailure";
  }
}
