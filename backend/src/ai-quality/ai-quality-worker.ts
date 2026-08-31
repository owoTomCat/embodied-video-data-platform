import "reflect-metadata";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NestFactory } from "@nestjs/core";

import {
  aiQualityConcurrency,
} from "./ai-quality.config.js";
import { AiQualityWorkerModule } from "./ai-quality-worker.module.js";
import { RabbitAiQualityWorker } from "./rabbit-ai-quality-worker.js";

async function start(): Promise<void> {
  const rabbitUrl = process.env.RABBITMQ_URL?.trim();
  if (!rabbitUrl) throw new Error("RABBITMQ_URL is required");
  if (!process.env.QWEN_API_KEY?.trim()) {
    throw new Error("QWEN_API_KEY is required");
  }
  const concurrency = aiQualityConcurrency(
    process.env.AI_QUALITY_CONCURRENCY,
  );
  const application = await NestFactory.createApplicationContext(
    AiQualityWorkerModule,
  );
  const worker = application.get(RabbitAiQualityWorker);
  await worker.start(rabbitUrl, concurrency);
  const shutdown = async () => {
    await worker.close();
    await application.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await start();
}
