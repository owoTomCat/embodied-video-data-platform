import type { ConfirmChannel } from "amqplib";

export const EVENTS_EXCHANGE = "evdp.events";
export const DEAD_EVENTS_EXCHANGE = `${EVENTS_EXCHANGE}.dead`;
export const MEDIA_QUEUE = "evdp.media.probe.v1";
export const DEAD_MEDIA_QUEUE = `${MEDIA_QUEUE}.dead`;
export const MEDIA_ROUTING_KEY = "media.probe.v1";
export const AI_QUALITY_QUEUE = "evdp.ai.quality.v1";
export const DEAD_AI_QUALITY_QUEUE = `${AI_QUALITY_QUEUE}.dead`;
export const AI_QUALITY_ROUTING_KEY = "ai.quality.v1";
export const AI_ANNOTATION_QUEUE = "evdp.ai.annotation.v1";
export const DEAD_AI_ANNOTATION_QUEUE = `${AI_ANNOTATION_QUEUE}.dead`;
export const AI_ANNOTATION_ROUTING_KEY = "ai.annotation.v1";
export const MEDIA_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const AI_QUALITY_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const AI_ANNOTATION_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;

export async function assertMediaTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertQueue(DEAD_MEDIA_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_MEDIA_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    MEDIA_ROUTING_KEY,
  );
  await channel.assertQueue(MEDIA_QUEUE, MEDIA_QUEUE_OPTIONS);
  await channel.bindQueue(MEDIA_QUEUE, EVENTS_EXCHANGE, MEDIA_ROUTING_KEY);
}

export async function assertAiQualityTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertQueue(DEAD_AI_QUALITY_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_AI_QUALITY_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    AI_QUALITY_ROUTING_KEY,
  );
  await channel.assertQueue(AI_QUALITY_QUEUE, AI_QUALITY_QUEUE_OPTIONS);
  await channel.bindQueue(
    AI_QUALITY_QUEUE,
    EVENTS_EXCHANGE,
    AI_QUALITY_ROUTING_KEY,
  );
}

export async function assertAiAnnotationTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertQueue(DEAD_AI_ANNOTATION_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_AI_ANNOTATION_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    AI_ANNOTATION_ROUTING_KEY,
  );
  await channel.assertQueue(
    AI_ANNOTATION_QUEUE,
    AI_ANNOTATION_QUEUE_OPTIONS,
  );
  await channel.bindQueue(
    AI_ANNOTATION_QUEUE,
    EVENTS_EXCHANGE,
    AI_ANNOTATION_ROUTING_KEY,
  );
}
