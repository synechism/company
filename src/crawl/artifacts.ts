import fs from "node:fs/promises";
import path from "node:path";

export function safeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function companyOutputDir(baseDir: string, companyId: string): string {
  return path.join(baseDir, safeName(companyId));
}

export async function writeJson(pathname: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(pathname: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, value, "utf8");
}

export async function appendJsonl(pathname: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.appendFile(pathname, `${JSON.stringify(value)}\n`, "utf8");
}
