#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "fcdx");
const source = path.join(packageRoot, "dist", "cli", "fcdx.js");
const dataDir = path.resolve(process.env.FCDX_DATA_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "fcdx"));
const configPath = path.resolve(process.env.FCDX_CONFIG || path.join(os.homedir(), ".config", "fcdx", "config.json"));
const dbPath = path.resolve(process.env.FCDX_INSTALL_DB_PATH || path.join(dataDir, "fcdx.duckdb"));
const firecrawlCacheDir = path.resolve(process.env.FCDX_INSTALL_FIRECRAWL_CACHE_DIR || path.join(dataDir, "cache", "firecrawl"));
const datasetPath = process.env.FCDX_INSTALL_DATASET_PATH ? path.resolve(process.env.FCDX_INSTALL_DATASET_PATH) : undefined;
const parquetPath = process.env.FCDX_INSTALL_PARQUET_PATH ? path.resolve(process.env.FCDX_INSTALL_PARQUET_PATH) : undefined;

if (!fs.existsSync(source)) {
  console.error(`Missing built CLI at ${source}. Run pnpm build first.`);
  process.exit(1);
}

const installDir = await chooseInstallDir();
await fsp.mkdir(installDir, { recursive: true });
await fsp.mkdir(dataDir, { recursive: true });
await fsp.mkdir(firecrawlCacheDir, { recursive: true });

const target = path.join(installDir, process.platform === "win32" ? "fcdx.cmd" : "fcdx");
if (process.platform === "win32") {
  const command = `@echo off\r\nnode "${source}" %*\r\n`;
  await fsp.writeFile(target, command, "utf8");
} else {
  await fsp.rm(target, { force: true });
  await fsp.symlink(source, target);
  await fsp.chmod(source, 0o755);
}

const config = await writeConfig();

console.log(
  JSON.stringify(
    {
      installed: true,
      bin: target,
      source,
      dataDir,
      configPath,
      config,
      nextSteps: [
        "Put the PDL CSV or Parquet somewhere on this machine.",
        `Run: fcdx config init --dataset /path/to/free_company_dataset.csv --db ${dbPath} --firecrawl-cache-dir ${firecrawlCacheDir} --force`,
        `Or:  fcdx config init --parquet /path/to/free_company_dataset.parquet --db ${dbPath} --firecrawl-cache-dir ${firecrawlCacheDir} --force`,
        "Then run: fcdx db init --replace",
      ],
    },
    null,
    2,
  ),
);

async function writeConfig() {
  const existing = await readExistingConfig();
  const next = { ...existing };
  next.dbPath ??= dbPath;
  next.firecrawlCacheDir ??= firecrawlCacheDir;
  if (datasetPath) next.datasetPath = datasetPath;
  if (parquetPath) next.parquetPath = parquetPath;
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function readExistingConfig() {
  try {
    return JSON.parse(await fsp.readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

async function chooseInstallDir() {
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const nodeBinDir = path.dirname(process.execPath);
  if (pathDirs.includes(nodeBinDir) && await isWritableDirectory(nodeBinDir)) return nodeBinDir;

  for (const dir of pathDirs) {
    if (isPackageManagerBinDir(dir)) continue;
    if (isEphemeralPathDir(dir)) continue;
    if (await isWritableDirectory(dir)) return dir;
  }

  const fallback = path.join(os.homedir(), ".local", "bin");
  if (!pathDirs.includes(fallback)) {
    console.error(`No writable PATH directory found. Installing to ${fallback}; add it to PATH if fcdx is not found.`);
  }
  return fallback;
}

function isEphemeralPathDir(dir) {
  const normalized = path.normalize(dir);
  return (
    normalized.startsWith(path.normalize(os.tmpdir()) + path.sep) ||
    normalized.includes(`${path.sep}.codex${path.sep}tmp${path.sep}`)
  );
}

function isPackageManagerBinDir(dir) {
  const normalized = path.normalize(dir);
  return (
    normalized.includes(`${path.sep}node_modules${path.sep}.bin`) ||
    normalized.includes(`${path.sep}.pnpm${path.sep}`) ||
    normalized.endsWith(`${path.sep}node-gyp-bin`) ||
    normalized.includes(`${path.sep}node_modules${path.sep}pnpm${path.sep}`)
  );
}

async function isWritableDirectory(dir) {
  try {
    const stats = await fsp.stat(dir);
    if (!stats.isDirectory()) return false;
    await fsp.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
