import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_DATASET_PATH =
  process.env.PDL_COMPANY_CSV || path.join(os.homedir(), ".local", "share", "fcdx", "free_company_dataset.csv");

export type FcdxConfig = {
  dbPath?: string;
  datasetPath?: string;
  parquetPath?: string;
  firecrawlCacheDir?: string;
  env?: Record<string, string>;
  currentProfile?: string;
  profiles?: Record<string, FcdxProfile>;
};

export type FcdxProfile = {
  name?: string;
  unipileLinkedinAccountId?: string;
  unipileLinkedinHandle?: string;
  unipileLinkedinName?: string;
};

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".config", "fcdx", "config.json");
export const DEFAULT_LOCAL_DB_PATH = "output/fcdx.duckdb";

export function fcdxConfigPath(): string {
  return process.env.FCDX_CONFIG || DEFAULT_CONFIG_PATH;
}

export function loadFcdxConfig(configPath = fcdxConfigPath()): FcdxConfig {
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as FcdxConfig;
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function saveFcdxConfig(config: FcdxConfig, configPath = fcdxConfigPath()): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function applyFcdxConfigEnv(configPath = fcdxConfigPath()): void {
  const config = loadFcdxConfig(configPath);
  for (const [key, value] of Object.entries(config.env ?? {})) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function resolveDbPath(explicitPath?: string): string {
  return explicitPath || loadFcdxConfig().dbPath || process.env.FCDX_DB_PATH || DEFAULT_LOCAL_DB_PATH;
}

export function resolveDatasetPath(explicitPath?: string): string {
  return explicitPath || loadFcdxConfig().datasetPath || DEFAULT_DATASET_PATH;
}

export function resolveParquetPath(explicitPath?: string): string | undefined {
  return explicitPath || loadFcdxConfig().parquetPath || process.env.FCDX_PARQUET_PATH;
}

export function resolveFirecrawlCacheDir(explicitPath?: string): string {
  return explicitPath || loadFcdxConfig().firecrawlCacheDir || "output/cache/firecrawl";
}

export function activeProfileName(config = loadFcdxConfig()): string {
  return config.currentProfile || "default";
}

export function activeProfile(config = loadFcdxConfig()): FcdxProfile {
  return config.profiles?.[activeProfileName(config)] ?? {};
}

export function setActiveProfile(profileName: string, patch: FcdxProfile, configPath = fcdxConfigPath()): FcdxConfig {
  const config = loadFcdxConfig(configPath);
  const profiles = { ...(config.profiles ?? {}) };
  profiles[profileName] = { ...(profiles[profileName] ?? {}), ...patch, name: patch.name ?? profiles[profileName]?.name ?? profileName };
  const next = { ...config, currentProfile: profileName, profiles };
  saveFcdxConfig(next, configPath);
  return next;
}

export function resolveConfigEnv(key: string): string | undefined {
  return process.env[key] || loadFcdxConfig().env?.[key];
}

export const TARGET_INDUSTRIES = new Set([
  "construction",
  "electrical/electronic manufacturing",
  "mechanical or industrial engineering",
]);

export const STRICT_SIZE_BUCKETS = new Set([
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
]);

export const LOOSE_SIZE_BUCKETS = new Set(["51-200", ...STRICT_SIZE_BUCKETS]);

export function selectedSizeBuckets(include51200: boolean): Set<string> {
  return include51200 ? LOOSE_SIZE_BUCKETS : STRICT_SIZE_BUCKETS;
}
