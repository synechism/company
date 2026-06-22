#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "fcdx");
const source = path.join(packageRoot, "dist", "cli", "fcdx.js");
const dataDir = path.resolve(process.env.FCDX_DATA_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "fcdx"));
const configPath = path.resolve(process.env.FCDX_CONFIG || path.join(os.homedir(), ".config", "fcdx", "config.json"));
const dbPath = path.resolve(process.env.FCDX_INSTALL_DB_PATH || path.join(dataDir, "fcdx.duckdb"));
const firecrawlCacheDir = path.resolve(process.env.FCDX_INSTALL_FIRECRAWL_CACHE_DIR || path.join(dataDir, "cache", "firecrawl"));
const replaceDb = process.env.FCDX_INSTALL_REPLACE_DB === "1";
const copyParquet = process.env.FCDX_INSTALL_COPY_PARQUET === "1";

if (!fs.existsSync(source)) {
  console.error(`Missing built CLI at ${source}. Run pnpm build first.`);
  process.exit(1);
}

const installDir = await chooseInstallDir();
await fsp.mkdir(installDir, { recursive: true });
await fsp.mkdir(dataDir, { recursive: true });

const target = path.join(installDir, process.platform === "win32" ? "fcdx.cmd" : "fcdx");
if (process.platform === "win32") {
  const command = `@echo off\r\nnode "${source}" %*\r\n`;
  await fsp.writeFile(target, command, "utf8");
} else {
  await fsp.rm(target, { force: true });
  await fsp.symlink(source, target);
  await fsp.chmod(source, 0o755);
}

const bundledParquet = await resolveBundledParquet();
const dbInstall = bundledParquet
  ? await installDuckDbFromParquet(bundledParquet)
  : {
      installed: false,
      reason: "No bundled Parquet found. Set FCDX_INSTALL_PARQUET or place data/free_company_dataset.parquet in the package.",
    };
const config = await writeConfig(bundledParquet ? dbInstall.parquetPath : undefined);

console.log(
  JSON.stringify(
    {
      installed: true,
      bin: target,
      source,
      dataDir,
      configPath,
      db: dbInstall,
      config,
    },
    null,
    2,
  ),
);

async function resolveBundledParquet() {
  const candidates = [
    process.env.FCDX_INSTALL_PARQUET,
    path.join(packageRoot, "data", "free_company_dataset.parquet"),
    path.join(root, "data", "free_company_dataset.parquet"),
  ].filter((value) => value && value.trim().length > 0);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return undefined;
}

async function installDuckDbFromParquet(sourceParquet) {
  const parquetPath = copyParquet ? path.join(dataDir, "free_company_dataset.parquet") : path.resolve(sourceParquet);
  if (copyParquet && path.resolve(sourceParquet) !== path.resolve(parquetPath)) {
    await fsp.copyFile(sourceParquet, parquetPath);
  }

  if (fs.existsSync(dbPath) && !replaceDb) {
    return {
      installed: false,
      skipped: true,
      reason: "DuckDB already exists; set FCDX_INSTALL_REPLACE_DB=1 to rebuild it.",
      dbPath,
      parquetPath,
    };
  }

  const { initializeFcdxDb } = await import(pathToFileURL(path.join(packageRoot, "dist", "db", "fcdx.js")).href);
  const summary = await initializeFcdxDb({
    dbPath,
    sourcePath: parquetPath,
    sourceType: "parquet",
    replace: true,
  });
  return {
    installed: true,
    dbPath,
    parquetPath,
    summary,
  };
}

async function writeConfig(parquetPath) {
  const existing = await readExistingConfig();
  const next = { ...existing };
  if (parquetPath) {
    next.dbPath = dbPath;
    next.parquetPath = parquetPath;
    next.firecrawlCacheDir = firecrawlCacheDir;
  } else {
    next.dbPath ??= dbPath;
    next.firecrawlCacheDir ??= firecrawlCacheDir;
  }
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
