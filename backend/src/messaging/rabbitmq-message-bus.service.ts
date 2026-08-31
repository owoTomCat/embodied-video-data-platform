import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
} from "amqplib";

import type {
  MessageBusPort,
  PublishMessage,
} from "./message-bus.port.js";
import {
  assertAiAnnotationTopology,
  assertAiQualityTopology,
  assertMediaTopology,
  EVENTS_EXCHANGE,
} from "./rabbitmq-topology.js";

export class RabbitMqMessageBusService implements MessageBusPort {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel> | null = null;

  constructor(private readonly url: string) {}

  async publish(message: PublishMessage): Promise<void> {
    const channel = await this.getChannel();
    channel.publish(
      EVENTS_EXCHANGE,
      message.routingKey,
      Buffer.from(JSON.stringify(message.payload), "utf8"),
      {
        appId: "evdp-api",
        contentType: "application/json",
        deliveryMode: 2,
        messageId: message.messageId,
        persistent: true,
        timestamp: Date.now(),
        type: message.routingKey,
      },
    );
    await channel.waitForConfirms();
  }

  async close(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    this.connecting = null;
    if (channel) await channel.close().catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectChannel();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connectChannel(): Promise<ConfirmChannel> {
    const connection = await connect(this.url);
    connection.on("close", () => {
      this.connection = null;
      this.channel = null;
    });
    connection.on("error", () => {
      this.connection = null;
      this.channel = null;
    });
    const channel = await connection.createConfirmChannel();
    await assertMediaTopology(channel);
    await assertAiQualityTopology(channel);
    await assertAiAnnotationTopology(channel);
    this.connection = connection;
    this.channel = channel;
    return channel;
  }
}
