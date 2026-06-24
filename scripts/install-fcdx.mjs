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

const installChoice = await chooseInstallDir();
if (installChoice.needsManualInstall) {
  console.error(`No writable non-pnpm directory on PATH was found.`);
  console.error(`Run this command to install fcdx into /usr/local/bin:`);
  console.error(`  ${installChoice.manualCommand}`);
  process.exit(1);
}
const installDir = installChoice.dir;
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
const pathActive = isOnPath(installDir);

console.log(
  JSON.stringify(
    {
      installed: true,
      bin: target,
      source,
      pathActive,
      dataDir,
      configPath,
      config,
      nextSteps: [
        "Run: fcdx --help",
        "Put the PDL CSV or Parquet somewhere on this machine.",
        `Run: fcdx config init --dataset /path/to/free_company_dataset.csv --db ${dbPath} --firecrawl-cache-dir ${firecrawlCacheDir} --force`,
        `Or:  fcdx config init --parquet /path/to/free_company_dataset.parquet --db ${dbPath} --firecrawl-cache-dir ${firecrawlCacheDir} --force`,
        "Then run: fcdx db init --replace",
        "Optional: store service credentials with fcdx config env set FIRECRAWL_API_KEY <key>",
        "Optional: store LinkedIn credentials with fcdx config env set UNIPILE_ACCESS_TOKEN <token>",
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
  const explicitDir = process.env.FCDX_INSTALL_BIN_DIR ? path.resolve(process.env.FCDX_INSTALL_BIN_DIR) : undefined;
  if (explicitDir) return { dir: explicitDir };

  const pnpmHome = process.env.PNPM_HOME ? path.resolve(process.env.PNPM_HOME) : undefined;
  if (pnpmHome && isOnPath(pnpmHome) && !isPackageManagerBinDir(pnpmHome) && await isWritableDirectory(pnpmHome)) {
    return { dir: pnpmHome };
  }

  const userBin = path.join(os.homedir(), ".local", "bin");
  if (isOnPath(userBin) && await isWritableOrCreatableDirectory(userBin)) return { dir: userBin };

  if (pathDirs.includes(nodeBinDir) && !isPackageManagerBinDir(nodeBinDir) && await isWritableDirectory(nodeBinDir)) {
    return { dir: nodeBinDir };
  }

  for (const dir of pathDirs) {
    if (isPackageManagerBinDir(dir)) continue;
    if (isEphemeralPathDir(dir)) continue;
    if (await isWritableDirectory(dir)) return { dir };
  }

  const target = "/usr/local/bin/fcdx";
  return {
    needsManualInstall: true,
    manualCommand: `sudo ln -sf "${source}" "${target}" && sudo chmod 755 "${source}"`,
  };
}

function isOnPath(dir) {
  const resolved = path.resolve(dir);
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry) === resolved);
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
    normalized.includes(`${path.sep}pnpm${path.sep}store${path.sep}`) ||
    normalized.includes(`${path.sep}pnpm${path.sep}global${path.sep}`) ||
    normalized.includes(`${path.sep}store${path.sep}v`) ||
    normalized.includes(`${path.sep}links${path.sep}`) ||
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

async function isWritableOrCreatableDirectory(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    return isWritableDirectory(dir);
  } catch {
    return false;
  }
}
