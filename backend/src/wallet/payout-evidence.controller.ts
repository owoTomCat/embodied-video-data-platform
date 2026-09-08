import { Controller, Get, Header, HttpCode, Injectable, Param, Post, Res, StreamableFile, UploadedFile, UseFilters, UseGuards, UseInterceptors, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { WalletFailure } from "./wallet.failure.js";
import { MAX_PAYOUT_EVIDENCE_BYTES, PayoutEvidenceService } from "./payout-evidence.service.js";

// Runs before multipart parsing, so unauthorized users cannot allocate upload buffers.
@Injectable()
export class PayoutEvidenceAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const actor = context.switchToHttp().getRequest<{ user?: PublicUser }>().user;
    if (!actor || actor.role !== "admin" || actor.status !== "active") throw new WalletFailure("FORBIDDEN", "仅有效管理员可访问提现凭证", 403);
    return true;
  }
}

@Controller("wallet/withdrawals")
@UseGuards(SessionGuard, PayoutEvidenceAdminGuard)
@UseFilters(WalletFailureFilter)
export class PayoutEvidenceController {
  constructor(private readonly evidence: PayoutEvidenceService) {}

  @Post(":id/evidence") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  @Header("Cache-Control", "no-store")
  // Busboy signals at equality; service validation keeps the inclusive 5MiB boundary.
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_PAYOUT_EVIDENCE_BYTES + 1, files: 1, fields: 0, parts: 2 } }))
  async upload(@CurrentUser() actor: PublicUser, @Param("id") requestId: string, @UploadedFile() file?: Express.Multer.File) {
    return { evidence: await this.evidence.upload(actor, requestId, file) };
  }

  @Get(":id/evidence/:evidenceId/content")
  @Header("Cache-Control", "no-store") @Header("X-Content-Type-Options", "nosniff")
  async download(@CurrentUser() actor: PublicUser, @Param("id") requestId: string, @Param("evidenceId") evidenceId: string,
    @Res({ passthrough: true }) response: Response) {
    const result = await this.evidence.download(actor, requestId, evidenceId);
    const encodedName = encodeURIComponent(result.originalFileName).replace(/['()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader("Content-Disposition", `attachment; filename="evidence"; filename*=UTF-8''${encodedName}`);
    return new StreamableFile(result.bytes, { type: result.contentType, length: result.bytes.length });
  }
}
