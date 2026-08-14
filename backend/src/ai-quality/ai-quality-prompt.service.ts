import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../database/entities/video-quality-prompt-version.entity.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import { loadVideoQualityPrompt } from "../video-quality/prompt-loader.js";
import { videoQualityPromptPath } from "./ai-quality.config.js";

const PROMPT_LOCK_KEY = 7_326_195_420;

function normalizeSystemPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) {
    throw new IdentityFailure("VALIDATION", "系统提示词不能为空", 400);
  }
  if (prompt.length > 100_000) {
    throw new IdentityFailure("VALIDATION", "系统提示词不能超过 100000 个字符", 400);
  }
  if (!/video_qc_v2_traceable/u.test(prompt) || !/JSON/iu.test(prompt)) {
    throw new IdentityFailure(
      "VALIDATION",
      "系统提示词必须保留 video_qc_v2_traceable 和 JSON 结构化输出约束",
      400,
    );
  }
  return prompt;
}

function contentSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

@Injectable()
export class AiQualityPromptService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(VideoQualityPromptVersionEntity)
    private readonly prompts: Repository<VideoQualityPromptVersionEntity>,
    private readonly audit: AuditService,
  ) {}

  async ensureDefault(): Promise<VideoQualityPromptVersionEntity> {
    const loaded = await loadVideoQualityPrompt(videoQualityPromptPath());
    const current = await this.prompts.findOneBy({ active: true });
    if (
      current &&
      current.promptVersion === loaded.promptVersion &&
      current.ruleVersion === loaded.ruleVersion
    ) return current;

    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [PROMPT_LOCK_KEY]);
      const repository = manager.getRepository(VideoQualityPromptVersionEntity);
      const active = await repository.findOneBy({ active: true });
      if (
        active &&
        active.promptVersion === loaded.promptVersion &&
        active.ruleVersion === loaded.ruleVersion
      ) return active;
      const creator = await manager.getRepository(UserEntity).findOne({
        where: { role: "admin", status: "active" },
        order: { createdAt: "ASC" },
      });
      if (!creator) {
        throw new Error("初始化 AI 质检提示词前必须存在启用的管理员账号");
      }
      if (active) {
        active.active = false;
        await repository.save(active);
      }
      return repository.save({
        id: `VQP-${randomUUID()}`,
        revision: (active?.revision ?? 0) + 1,
        systemPrompt: loaded.systemPrompt,
        contentSha256: contentSha256(loaded.systemPrompt),
        promptVersion: loaded.promptVersion,
        ruleVersion: loaded.ruleVersion,
        outputSchema: loaded.outputSchema,
        initialModel: loaded.initialModel,
        reviewModel: loaded.reviewModel,
        active: true,
        createdByAccountId: creator.id,
        createdByName: active ? "系统规则升级" : "系统初始化",
      });
    });
  }

  async getActive(actor?: PublicUser): Promise<VideoQualityPromptVersionEntity> {
    if (actor) this.requireAdmin(actor);
    return this.ensureDefault();
  }

  async update(
    actor: PublicUser,
    value: string,
  ): Promise<VideoQualityPromptVersionEntity> {
    this.requireAdmin(actor);
    const systemPrompt = normalizeSystemPrompt(value);
    const committed = await loadVideoQualityPrompt(videoQualityPromptPath());
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [PROMPT_LOCK_KEY]);
      const repository = manager.getRepository(VideoQualityPromptVersionEntity);
      const current = await repository.findOne({
        where: { active: true },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error("当前 AI 质检提示词不存在");
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `VQP-${randomUUID()}`,
        revision: current.revision + 1,
        systemPrompt,
        contentSha256: contentSha256(systemPrompt),
        promptVersion: committed.promptVersion,
        ruleVersion: committed.ruleVersion,
        outputSchema: committed.outputSchema,
        initialModel: committed.initialModel,
        reviewModel: committed.reviewModel,
        active: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "ai_quality_prompt_update",
        { id: next.id, name: `AI 提示词版本 ${next.revision}` },
        `发布 AI 系统提示词版本 ${next.revision}`,
        { revision: current.revision, contentSha256: current.contentSha256 },
        { revision: next.revision, contentSha256: next.contentSha256 },
      );
      return next;
    });
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new IdentityFailure("FORBIDDEN", "仅管理员可管理 AI 系统提示词", 403);
    }
  }
}
