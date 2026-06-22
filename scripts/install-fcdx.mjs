#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "packages", "fcdx", "dist", "cli", "fcdx.js");

if (!fs.existsSync(source)) {
  console.error(`Missing built CLI at ${source}. Run pnpm build first.`);
  process.exit(1);
}

const installDir = await chooseInstallDir();
await fsp.mkdir(installDir, { recursive: true });

const target = path.join(installDir, process.platform === "win32" ? "fcdx.cmd" : "fcdx");
if (process.platform === "win32") {
  const command = `@echo off\r\nnode "${source}" %*\r\n`;
  await fsp.writeFile(target, command, "utf8");
} else {
  await fsp.rm(target, { force: true });
  await fsp.symlink(source, target);
  await fsp.chmod(source, 0o755);
}

console.log(JSON.stringify({ installed: true, bin: target, source }, null, 2));

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
