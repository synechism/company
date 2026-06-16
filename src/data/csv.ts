import fs from "node:fs";
import { parse } from "csv-parse";
import type { CompanyRecord } from "../types.js";

export async function* streamCompanyCsv(path: string): AsyncGenerator<CompanyRecord> {
  const parser = fs.createReadStream(path).pipe(
    parse({
      bom: true,
      columns: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
    }),
  );

  for await (const record of parser) {
    yield record as CompanyRecord;
  }
}

export function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function cleanLower(value: unknown): string {
  return clean(value).toLowerCase();
}

export function normalizeWebsite(website: string): string {
  const raw = website.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function stableShard(id: string, shardCount: number): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % shardCount;
}
