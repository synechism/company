import { Queue } from "bullmq";
import { loadDeepResearchApiConfig } from "./config.js";
import type { DeepResearchJobData, DeepResearchJobResult } from "./types.js";

export function createRedisConnectionOptions(): Record<string, unknown> {
  const config = loadDeepResearchApiConfig();
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== "/" ? Number.parseInt(url.pathname.slice(1), 10) : undefined,
    maxRetriesPerRequest: null,
  };
}

export function createDeepResearchQueue() {
  const config = loadDeepResearchApiConfig();
  return new Queue<DeepResearchJobData, DeepResearchJobResult, string>(config.queueName, {
    connection: createRedisConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  });
}
