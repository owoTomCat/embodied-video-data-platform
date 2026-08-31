import type { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import { vi } from "vitest";

import { AI_ANNOTATION_QUEUE } from "../src/messaging/rabbitmq-topology.js";
import {
  RetryableAnnotationRunError,
} from "../src/video-annotation/annotation-run.service.js";
import { RabbitAnnotationWorker } from "../src/video-annotation/rabbit-annotation-worker.js";

function rabbitHarness() {
  let consumer: ((message: ConsumeMessage | null) => void) | undefined;
  const channel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockImplementation(
      async (_queue: string, handler: (message: ConsumeMessage | null) => void) => {
        consumer = handler;
        return { consumerTag: "annotation-test" };
      },
    ),
    sendToQueue: vi.fn().mockReturnValue(true),
    waitForConfirms: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    reject: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConfirmChannel;
  const connection = {
    createConfirmChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChannelModel;
  return {
    channel,
    connector: vi.fn().mockResolvedValue(connection),
    consumer: () => consumer,
  };
}

describe("annotation worker", () => {
  it("consumes a separate queue with independent concurrency", async () => {
    const rabbit = rabbitHarness();
    const runs = { process: vi.fn().mockResolvedValue("processed") };
    const heartbeats = {
      start: vi.fn().mockResolvedValue("ai_annotation-test-host-1"),
      beat: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      recordTaskFinished: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new RabbitAnnotationWorker(runs as never, heartbeats as never);

    await worker.start("amqp://test", 2, rabbit.connector);

    expect(rabbit.channel.prefetch).toHaveBeenCalledWith(2);
    expect(rabbit.channel.consume).toHaveBeenCalledWith(
      AI_ANNOTATION_QUEUE,
      expect.any(Function),
    );
    expect(heartbeats.start).toHaveBeenCalledWith("ai_annotation");
    await worker.close();
    expect(heartbeats.stop).toHaveBeenCalledWith("ai_annotation-test-host-1");
  });

  it("uses finite retry queues and dead-letters the fourth delivery", async () => {
    const rabbit = rabbitHarness();
    const runs = {
      process: vi.fn().mockRejectedValue(new RetryableAnnotationRunError("retry")),
    };
    const worker = new RabbitAnnotationWorker(runs as never);
    await worker.start("amqp://test", 1, rabbit.connector);

    const first = {
      content: Buffer.from(JSON.stringify({ runId: "ANR-1" })),
      properties: { headers: { "retry-attempt": 0 } },
    } as unknown as ConsumeMessage;
    rabbit.consumer()?.(first);
    await vi.waitFor(() => expect(rabbit.channel.ack).toHaveBeenCalledWith(first));
    expect(rabbit.channel.sendToQueue).toHaveBeenCalledWith(
      `${AI_ANNOTATION_QUEUE}.retry.1`,
      first.content,
      expect.objectContaining({
        headers: { "retry-attempt": 1 },
        persistent: true,
      }),
    );

    vi.mocked(rabbit.channel.sendToQueue).mockClear();
    const final = {
      content: Buffer.from(JSON.stringify({ runId: "ANR-1" })),
      properties: { headers: { "retry-attempt": 3 } },
    } as unknown as ConsumeMessage;
    rabbit.consumer()?.(final);
    await vi.waitFor(() => expect(rabbit.channel.reject).toHaveBeenCalledWith(final, false));
    expect(rabbit.channel.sendToQueue).not.toHaveBeenCalled();
    expect(runs.process).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "ANR-1",
        terminalOnRetryableFailure: true,
      }),
    );
    await worker.close();
  });

  it("acks duplicate lock-busy delivery without creating an infinite retry loop", async () => {
    const rabbit = rabbitHarness();
    const runs = { process: vi.fn().mockResolvedValue("lock_busy") };
    const worker = new RabbitAnnotationWorker(runs as never);
    await worker.start("amqp://test", 1, rabbit.connector);
    const message = {
      content: Buffer.from(JSON.stringify({ runId: "ANR-BUSY" })),
      properties: { headers: { "retry-attempt": 3 } },
    } as unknown as ConsumeMessage;

    rabbit.consumer()?.(message);
    await vi.waitFor(() => expect(rabbit.channel.ack).toHaveBeenCalledWith(message));

    expect(rabbit.channel.sendToQueue).not.toHaveBeenCalled();
    await worker.close();
  });
});
