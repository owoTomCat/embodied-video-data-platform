import "reflect-metadata";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NestFactory } from "@nestjs/core";

import { aiAnnotationConcurrency } from "../ai-quality/ai-quality.config.js";
import { AnnotationWorkerModule } from "./annotation-worker.module.js";
import { RabbitAnnotationWorker } from "./rabbit-annotation-worker.js";

async function start(): Promise<void> {
  const rabbitUrl = process.env.RABBITMQ_URL?.trim();
  if (!rabbitUrl) throw new Error("RABBITMQ_URL is required");
  if (!process.env.QWEN_API_KEY?.trim()) throw new Error("QWEN_API_KEY is required");
  const application = await NestFactory.createApplicationContext(
    AnnotationWorkerModule,
  );
  const worker = application.get(RabbitAnnotationWorker);
  await worker.start(
    rabbitUrl,
    aiAnnotationConcurrency(process.env.AI_ANNOTATION_CONCURRENCY),
  );
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
