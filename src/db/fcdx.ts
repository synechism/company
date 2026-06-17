import fs from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { CandidateCompany } from "../types.js";
import { normalizeWebsite } from "../data/csv.js";

export const DEFAULT_DB_PATH = process.env.FCDX_DB_PATH ?? "output/fcdx.duckdb";

export type CompanyQuery = {
  industry?: string[];
  country?: string;
  headcountMin?: number;
  headcountMax?: number;
  company?: string;
  requireWebsite?: boolean;
  limit?: number;
};

export type DbInitOptions = {
  dbPath: string;
  csvPath: string;
  replace: boolean;
  limit?: number;
};

export async function connectFcdxDb(dbPath = DEFAULT_DB_PATH, options: { readOnly?: boolean } = {}): Promise<{
  instance: DuckDBInstance;
  connection: DuckDBConnection;
}> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const instance = await DuckDBInstance.create(dbPath, options.readOnly ? { access_mode: "READ_ONLY" } : undefined);
  const connection = await instance.connect();
  return { instance, connection };
}

export async function initializeFcdxDb(options: DbInitOptions): Promise<Record<string, unknown>> {
  const started = Date.now();
  const { instance, connection } = await connectFcdxDb(options.dbPath);
  try {
    if (options.replace) {
      await connection.run("DROP TABLE IF EXISTS companies");
      await connection.run("DROP TABLE IF EXISTS firecrawl_cache");
    }

    const limitSql = options.limit === undefined ? "" : ` LIMIT ${asPositiveInt(options.limit)}`;
    await connection.run(`
      CREATE TABLE IF NOT EXISTS companies AS
      SELECT
        lower(country) AS country,
        try_cast(founded AS INTEGER) AS founded,
        id,
        lower(industry) AS industry,
        linkedin_url,
        lower(locality) AS locality,
        lower(name) AS name,
        lower(region) AS region,
        size,
        website
      FROM read_csv(
        '${escapeSqlString(options.csvPath)}',
        header = true,
        columns = {
          'country': 'VARCHAR',
          'founded': 'VARCHAR',
          'id': 'VARCHAR',
          'industry': 'VARCHAR',
          'linkedin_url': 'VARCHAR',
          'locality': 'VARCHAR',
          'name': 'VARCHAR',
          'region': 'VARCHAR',
          'size': 'VARCHAR',
          'website': 'VARCHAR'
        },
        ignore_errors = true,
        null_padding = true,
        strict_mode = false,
        parallel = false
      )
      ${limitSql}
    `);

    await ensureSchema(connection);

    const rows = await one(connection, "SELECT count(*)::BIGINT AS count FROM companies");
    return {
      dbPath: options.dbPath,
      csvPath: options.csvPath,
      companies: Number(rows?.count ?? 0),
      elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

export async function ensureSchema(connection: DuckDBConnection): Promise<void> {
  await connection.run("CREATE INDEX IF NOT EXISTS companies_id_idx ON companies(id)");
  await connection.run("CREATE INDEX IF NOT EXISTS companies_name_idx ON companies(name)");
  await connection.run("CREATE INDEX IF NOT EXISTS companies_industry_idx ON companies(industry)");
  await connection.run(`
    CREATE TABLE IF NOT EXISTS firecrawl_cache (
      company_id VARCHAR PRIMARY KEY,
      company_name VARCHAR,
      website VARCHAR,
      url VARCHAR,
      cache_dir VARCHAR,
      raw_output_path VARCHAR,
      final_url VARCHAR,
      title VARCHAR,
      error VARCHAR,
      elapsed_ms BIGINT,
      updated_at TIMESTAMP
    )
  `);
}

export async function queryCompanies(
  connection: DuckDBConnection,
  query: CompanyQuery,
): Promise<CandidateCompany[]> {
  const where: string[] = [];
  const params: Record<string, string | number | boolean> = {};
  let companyRankSql = "";

  if (query.country) {
    where.push("country = $country");
    params.country = query.country.toLowerCase();
  }
  if (query.industry?.length) {
    where.push(`(${query.industry.map((_, index) => `industry ILIKE $industry${index}`).join(" OR ")})`);
    for (const [index, industry] of query.industry.entries()) params[`industry${index}`] = `%${industry.toLowerCase()}%`;
  }
  if (query.headcountMin !== undefined || query.headcountMax !== undefined) {
    const buckets = sizeBucketsForRange(query.headcountMin ?? 0, query.headcountMax ?? Number.MAX_SAFE_INTEGER);
    where.push(`size IN (${buckets.map((_, index) => `$size${index}`).join(", ")})`);
    for (const [index, bucket] of buckets.entries()) params[`size${index}`] = bucket;
  }
  if (query.company) {
    where.push("(name ILIKE $company OR website ILIKE $company)");
    params.company = `%${query.company}%`;
    params.companyExact = query.company.toLowerCase();
    params.companyDomain = query.company.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    params.companyPrefix = `${query.company.toLowerCase()}%`;
    companyRankSql = `
      CASE
        WHEN lower(name) = $companyExact THEN 0
        WHEN lower(website) = $companyDomain THEN 1
        WHEN lower(name) LIKE $companyPrefix THEN 2
        WHEN lower(website) LIKE $companyPrefix THEN 3
        ELSE 4
      END,
    `;
  }
  if (query.requireWebsite ?? true) {
    where.push("website IS NOT NULL AND length(trim(website)) > 0");
  }

  const sql = `
    SELECT country, founded, id, industry, linkedin_url, locality, name, region, size, website
    FROM companies
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${companyRankSql} name
    ${query.limit === undefined ? "" : `LIMIT ${asPositiveInt(query.limit)}`}
  `;
  const reader = await connection.runAndReadAll(sql, params);
  return reader.getRowObjectsJS().map(rowToCandidate).filter((row): row is CandidateCompany => row !== null);
}

export async function upsertFirecrawlCache(
  connection: DuckDBConnection,
  result: {
    companyId: string;
    companyName: string;
    website: string;
    url: string;
    cacheDir: string;
    rawOutputPath?: string;
    finalUrl?: string;
    title?: string;
    error?: string;
    elapsedMs: number;
  },
): Promise<void> {
  await ensureSchema(connection);
  await connection.run(
    `
    INSERT OR REPLACE INTO firecrawl_cache
      (company_id, company_name, website, url, cache_dir, raw_output_path, final_url, title, error, elapsed_ms, updated_at)
    VALUES
      ($companyId, $companyName, $website, $url, $cacheDir, $rawOutputPath, $finalUrl, $title, $error, $elapsedMs, now())
  `,
    {
      companyId: result.companyId,
      companyName: result.companyName,
      website: result.website,
      url: result.url,
      cacheDir: result.cacheDir,
      rawOutputPath: result.rawOutputPath ?? null,
      finalUrl: result.finalUrl ?? null,
      title: result.title ?? null,
      error: result.error ?? null,
      elapsedMs: result.elapsedMs,
    },
  );
}

function rowToCandidate(row: Record<string, unknown>): CandidateCompany | null {
  const id = text(row.id);
  const name = text(row.name);
  const website = text(row.website);
  const url = normalizeWebsite(website);
  if (!id || !name || !website || !url) return null;
  return {
    id,
    name,
    website,
    url,
    industry: text(row.industry),
    size: text(row.size),
    country: text(row.country),
    region: text(row.region) || undefined,
    locality: text(row.locality) || undefined,
    linkedinUrl: text(row.linkedin_url) || undefined,
    founded: typeof row.founded === "number" ? row.founded : undefined,
  };
}

function sizeBucketsForRange(min: number, max: number): string[] {
  const buckets = [
    { label: "1-10", min: 1, max: 10 },
    { label: "11-50", min: 11, max: 50 },
    { label: "51-200", min: 51, max: 200 },
    { label: "201-500", min: 201, max: 500 },
    { label: "501-1000", min: 501, max: 1000 },
    { label: "1001-5000", min: 1001, max: 5000 },
    { label: "5001-10000", min: 5001, max: 10000 },
    { label: "10001+", min: 10001, max: Number.MAX_SAFE_INTEGER },
  ];
  return buckets.filter((bucket) => bucket.max > min && bucket.min <= max).map((bucket) => bucket.label);
}

async function one(connection: DuckDBConnection, sql: string): Promise<Record<string, unknown> | undefined> {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjectsJS()[0];
}

function asPositiveInt(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Expected a positive integer, got ${value}`);
  return value;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}
