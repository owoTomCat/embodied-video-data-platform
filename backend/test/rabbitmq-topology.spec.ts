import type { ConfirmChannel } from "amqplib";
import { vi } from "vitest";

const connectMock = vi.hoisted(() => vi.fn());

vi.mock("amqplib", () => ({ connect: connectMock }));

import {
  AI_ANNOTATION_QUEUE,
  AI_ANNOTATION_QUEUE_OPTIONS,
  AI_QUALITY_QUEUE,
  AI_QUALITY_QUEUE_OPTIONS,
  assertAiQualityTopology,
  assertAiAnnotationTopology,
  assertMediaTopology,
  EVENTS_EXCHANGE,
  MEDIA_QUEUE,
  MEDIA_QUEUE_OPTIONS,
} from "../src/messaging/rabbitmq-topology.js";
import { RabbitMqMessageBusService } from "../src/messaging/rabbitmq-message-bus.service.js";

describe("RabbitMQ media topology", () => {
  it("declares one shared durable main queue with the dead-letter exchange", async () => {
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;

    await assertMediaTopology(channel);

    expect(channel.assertExchange).toHaveBeenCalledWith(
      EVENTS_EXCHANGE,
      "topic",
      { durable: true },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(
      MEDIA_QUEUE,
      MEDIA_QUEUE_OPTIONS,
    );
    expect(MEDIA_QUEUE_OPTIONS.arguments).toEqual({
      "x-dead-letter-exchange": "evdp.events.dead",
    });
  });
});

describe("RabbitMQ annotation topology", () => {
  it("declares a separate durable queue instead of sharing the quality queue", async () => {
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;

    await assertAiAnnotationTopology(channel);

    expect(AI_ANNOTATION_QUEUE).not.toBe(AI_QUALITY_QUEUE);
    expect(channel.assertQueue).toHaveBeenCalledWith(
      AI_ANNOTATION_QUEUE,
      AI_ANNOTATION_QUEUE_OPTIONS,
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      AI_ANNOTATION_QUEUE,
      EVENTS_EXCHANGE,
      "ai.annotation.v1",
    );
  });

  it("is declared by the publisher before the first annotation event", async () => {
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const connection = {
      on: vi.fn(),
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    };
    connectMock.mockResolvedValueOnce(connection);
    const bus = new RabbitMqMessageBusService("amqp://test");

    await bus.publish({
      messageId: "JOB-ANNOTATION",
      routingKey: "ai.annotation.v1",
      payload: { runId: "ANR-1" },
    });

    expect(channel.assertQueue).toHaveBeenCalledWith(
      AI_ANNOTATION_QUEUE,
      AI_ANNOTATION_QUEUE_OPTIONS,
    );
    expect(channel.publish).toHaveBeenCalledWith(
      EVENTS_EXCHANGE,
      "ai.annotation.v1",
      expect.any(Buffer),
      expect.objectContaining({ messageId: "JOB-ANNOTATION" }),
    );
    await bus.close();
  });
});

describe("RabbitMQ AI quality topology", () => {
  it("declares a durable AI queue with dead-letter routing", async () => {
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;

    await assertAiQualityTopology(channel);

    expect(channel.assertQueue).toHaveBeenCalledWith(
      AI_QUALITY_QUEUE,
      AI_QUALITY_QUEUE_OPTIONS,
    );
    expect(AI_QUALITY_QUEUE_OPTIONS.arguments).toEqual({
      "x-dead-letter-exchange": "evdp.events.dead",
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      AI_QUALITY_QUEUE,
      EVENTS_EXCHANGE,
      "ai.quality.v1",
    );
  });
});
