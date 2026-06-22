import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { CandidateCompany } from "../types.js";
import { ensureWorkspaceSchema, queryCompanies } from "./fcdx.js";

type DbParam = string | number | boolean | null;
type DbParams = Record<string, DbParam>;
const COMPANY_RESOLUTION_MATCH_LIMIT = 25;

export type CompanyList = {
  id: string;
  name: string;
  description?: string;
  metadata?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

export type ListMember = {
  company: CandidateCompany;
  source?: string;
  reason?: string;
  rank?: number;
  score?: number;
  fields: Record<string, unknown>;
  tags: Array<{ name: string; value?: string; confidence?: number; source?: string; reason?: string }>;
};

export class NoCompanyMatchError extends Error {
  constructor(
    public readonly company: string,
    public readonly country?: string,
  ) {
    super(`No company matched ${company}`);
    this.name = "NoCompanyMatchError";
  }
}

export class AmbiguousCompanyMatchError extends Error {
  constructor(
    public readonly company: string,
    public readonly matches: CandidateCompany[],
    public readonly country?: string,
    public readonly limit = COMPANY_RESOLUTION_MATCH_LIMIT,
  ) {
    super(`Company name is ambiguous: ${company}`);
    this.name = "AmbiguousCompanyMatchError";
  }
}

export async function migrateWorkspace(connection: DuckDBConnection): Promise<void> {
  await ensureWorkspaceSchema(connection);
}

export async function createList(
  connection: DuckDBConnection,
  input: { name: string; description?: string; metadata?: unknown },
): Promise<CompanyList> {
  await ensureWorkspaceSchema(connection);
  const id = randomUUID();
  await connection.run(
    `
    INSERT INTO lists (id, name, description, metadata_json, created_at, updated_at)
    VALUES ($id, $name, $description, $metadata, now(), now())
  `,
    {
      id,
      name: input.name,
      description: input.description ?? null,
      metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
    },
  );
  return getListOrThrow(connection, input.name);
}

export async function ensureList(
  connection: DuckDBConnection,
  input: { name: string; description?: string; metadata?: unknown },
): Promise<{ list: CompanyList; created: boolean }> {
  await ensureWorkspaceSchema(connection);
  const existing = await getList(connection, input.name);
  if (existing) return { list: existing, created: false };
  const list = await createList(connection, input);
  return { list, created: true };
}

export async function deleteList(connection: DuckDBConnection, name: string): Promise<{ id: string; name: string }> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, name);
  await connection.run("DELETE FROM list_field_values WHERE list_id = $id", { id: list.id });
  await connection.run("DELETE FROM list_fields WHERE list_id = $id", { id: list.id });
  await connection.run("DELETE FROM list_members WHERE list_id = $id", { id: list.id });
  await connection.run("DELETE FROM lists WHERE id = $id", { id: list.id });
  return { id: list.id, name: list.name };
}

export async function listLists(connection: DuckDBConnection): Promise<Array<CompanyList & { members: number }>> {
  await ensureWorkspaceSchema(connection);
  const rows = await all(
    connection,
    `
    SELECT l.id, l.name, l.description, l.metadata_json, l.created_at, l.updated_at, count(m.company_id)::BIGINT AS members
    FROM lists l
    LEFT JOIN list_members m ON m.list_id = l.id
    GROUP BY l.id, l.name, l.description, l.metadata_json, l.created_at, l.updated_at
    ORDER BY l.name
  `,
  );
  return rows.map((row) => ({ ...rowToList(row), members: Number(row.members ?? 0) }));
}

export async function addCompaniesToList(
  connection: DuckDBConnection,
  input: {
    listName: string;
    companies: CandidateCompany[];
    source?: string;
    reason?: string;
  },
): Promise<{ list: CompanyList; added: number; existing: number }> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, input.listName);
  let added = 0;
  let existing = 0;
  for (const company of input.companies) {
    const before = await one(
      connection,
      "SELECT 1 AS exists FROM list_members WHERE list_id = $listId AND company_id = $companyId",
      { listId: list.id, companyId: company.id },
    );
    if (before) existing += 1;
    else added += 1;
    await connection.run(
      `
      INSERT OR REPLACE INTO list_members
        (list_id, company_id, source, reason, rank, score, added_at, updated_at)
      VALUES
        ($listId, $companyId, $source, $reason, NULL, NULL, coalesce(
          (SELECT added_at FROM list_members WHERE list_id = $listId AND company_id = $companyId),
          now()
        ), now())
    `,
      {
        listId: list.id,
        companyId: company.id,
        source: input.source ?? null,
        reason: input.reason ?? null,
      },
    );
  }
  return { list, added, existing };
}

export async function addCompaniesFromJsonlToList(
  connection: DuckDBConnection,
  input: { listName: string; pathname: string; source?: string; reason?: string; limit?: number },
): Promise<{ list: CompanyList; added: number; existing: number }> {
  const raw = await fs.readFile(input.pathname, "utf8");
  const companies: CandidateCompany[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as CandidateCompany;
    companies.push(row);
    if (input.limit !== undefined && companies.length >= input.limit) break;
  }
  return addCompaniesToList(connection, {
    listName: input.listName,
    companies,
    source: input.source ?? `jsonl:${input.pathname}`,
    reason: input.reason,
  });
}

export async function addCompanyQueryToList(
  connection: DuckDBConnection,
  input: { listName: string; company: string; country?: string; source?: string; reason?: string },
): Promise<{ list: CompanyList; added: number; existing: number; matches: CandidateCompany[] }> {
  const company = await resolveCompanyId(connection, {
    company: input.company,
    country: input.country,
  });
  const result = await addCompaniesToList(connection, {
    listName: input.listName,
    companies: [company],
    source: input.source ?? "company-query",
    reason: input.reason ?? input.company,
  });
  return { ...result, matches: [company] };
}

export async function removeCompanyFromList(
  connection: DuckDBConnection,
  input: { listName: string; companyId: string },
): Promise<{ list: CompanyList; removed: number }> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, input.listName);
  const existing = await one(
    connection,
    "SELECT 1 AS exists FROM list_members WHERE list_id = $listId AND company_id = $companyId",
    { listId: list.id, companyId: input.companyId },
  );
  await connection.run("DELETE FROM list_field_values WHERE list_id = $listId AND company_id = $companyId", {
    listId: list.id,
    companyId: input.companyId,
  });
  await connection.run("DELETE FROM list_members WHERE list_id = $listId AND company_id = $companyId", {
    listId: list.id,
    companyId: input.companyId,
  });
  return { list, removed: existing ? 1 : 0 };
}

export async function showList(
  connection: DuckDBConnection,
  input: { listName: string; limit?: number },
): Promise<{ list: CompanyList; members: ListMember[] }> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, input.listName);
  const rows = await all(
    connection,
    `
    SELECT
      c.country, c.founded, c.id, c.industry, c.linkedin_url, c.locality, c.name, c.region, c.size, c.website,
      m.source, m.reason, m.rank, m.score
    FROM list_members m
    JOIN companies c ON c.id = m.company_id
    WHERE m.list_id = $listId
    ORDER BY coalesce(m.rank, 2147483647), c.name
    ${input.limit === undefined ? "" : `LIMIT ${positiveInt(input.limit)}`}
  `,
    { listId: list.id },
  );
  const fields = await listFieldValues(connection, list.id);
  const tags = await listMemberTags(connection, rows.map((row) => text(row.id)));
  return {
    list,
    members: rows.map((row) => ({
      company: rowToCandidate(row),
      source: text(row.source) || undefined,
      reason: text(row.reason) || undefined,
      rank: typeof row.rank === "number" ? row.rank : undefined,
      score: typeof row.score === "number" ? row.score : undefined,
      fields: fields.get(text(row.id)) ?? {},
      tags: tags.get(text(row.id)) ?? [],
    })),
  };
}

export async function listStats(connection: DuckDBConnection, listName: string): Promise<unknown> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, listName);
  const [total, byIndustry, bySize, tagCounts, fieldCounts] = await Promise.all([
    all(connection, "SELECT count(*)::BIGINT AS count FROM list_members WHERE list_id = $listId", { listId: list.id }),
    all(
      connection,
      `
      SELECT c.industry, count(*)::BIGINT AS count
      FROM list_members m JOIN companies c ON c.id = m.company_id
      WHERE m.list_id = $listId
      GROUP BY c.industry
      ORDER BY count DESC, c.industry
    `,
      { listId: list.id },
    ),
    all(
      connection,
      `
      SELECT c.size, count(*)::BIGINT AS count
      FROM list_members m JOIN companies c ON c.id = m.company_id
      WHERE m.list_id = $listId
      GROUP BY c.size
      ORDER BY count DESC, c.size
    `,
      { listId: list.id },
    ),
    all(
      connection,
      `
      SELECT t.name, count(*)::BIGINT AS count
      FROM list_members m
      JOIN company_tags ct ON ct.company_id = m.company_id
      JOIN tags t ON t.id = ct.tag_id
      WHERE m.list_id = $listId
      GROUP BY t.name
      ORDER BY count DESC, t.name
    `,
      { listId: list.id },
    ),
    all(
      connection,
      `
      SELECT field_key, count(*)::BIGINT AS count
      FROM list_field_values
      WHERE list_id = $listId
      GROUP BY field_key
      ORDER BY field_key
    `,
      { listId: list.id },
    ),
  ]);
  return {
    list,
    members: Number(total[0]?.count ?? 0),
    byIndustry: countRows(byIndustry, "industry"),
    bySize: countRows(bySize, "size"),
    tags: countRows(tagCounts, "name"),
    fields: countRows(fieldCounts, "field_key"),
  };
}

export async function setListFieldValue(
  connection: DuckDBConnection,
  input: {
    listName: string;
    companyId: string;
    fieldKey: string;
    value: unknown;
    fieldType?: string;
    description?: string;
    source?: string;
    confidence?: number;
  },
): Promise<{ list: CompanyList; companyId: string; fieldKey: string; value: unknown }> {
  const { list } = await defineListField(connection, {
    listName: input.listName,
    fieldKey: input.fieldKey,
    fieldType: input.fieldType,
    defaultFieldType: inferFieldType(input.value),
    description: input.description,
  });
  await connection.run(
    `
    INSERT OR REPLACE INTO list_field_values
      (list_id, company_id, field_key, value_json, source, confidence, updated_at)
    VALUES
      ($listId, $companyId, $fieldKey, $value, $source, $confidence, now())
  `,
    {
      listId: list.id,
      companyId: input.companyId,
      fieldKey: input.fieldKey,
      value: JSON.stringify(input.value),
      source: input.source ?? null,
      confidence: input.confidence ?? null,
    },
  );
  return { list, companyId: input.companyId, fieldKey: input.fieldKey, value: input.value };
}

export async function defineListField(
  connection: DuckDBConnection,
  input: { listName: string; fieldKey: string; fieldType?: string; defaultFieldType?: string; description?: string },
): Promise<{ list: CompanyList; fieldKey: string; fieldType: string; values: number }> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, input.listName);
  const existing = await one(
    connection,
    "SELECT field_type, description FROM list_fields WHERE list_id = $listId AND field_key = $fieldKey",
    { listId: list.id, fieldKey: input.fieldKey },
  );
  const fieldType = input.fieldType ?? (text(existing?.field_type) || input.defaultFieldType || "string");
  await connection.run(
    `
    INSERT OR REPLACE INTO list_fields
      (list_id, field_key, field_type, description, metadata_json, created_at, updated_at)
    VALUES
      ($listId, $fieldKey, $fieldType, $description, NULL, coalesce(
        (SELECT created_at FROM list_fields WHERE list_id = $listId AND field_key = $fieldKey),
        now()
      ), now())
  `,
    {
      listId: list.id,
      fieldKey: input.fieldKey,
      fieldType,
      description: input.description ?? (text(existing?.description) || null),
    },
  );
  const rows = await all(
    connection,
    "SELECT count(*)::BIGINT AS count FROM list_field_values WHERE list_id = $listId AND field_key = $fieldKey",
    { listId: list.id, fieldKey: input.fieldKey },
  );
  return { list, fieldKey: input.fieldKey, fieldType, values: Number(rows[0]?.count ?? 0) };
}

export async function listFields(connection: DuckDBConnection, listName: string): Promise<unknown> {
  await ensureWorkspaceSchema(connection);
  const list = await getListOrThrow(connection, listName);
  const fields = await all(
    connection,
    `
    SELECT f.field_key, f.field_type, f.description, count(v.company_id)::BIGINT AS values
    FROM list_fields f
    LEFT JOIN list_field_values v ON v.list_id = f.list_id AND v.field_key = f.field_key
    WHERE f.list_id = $listId
    GROUP BY f.field_key, f.field_type, f.description
    ORDER BY f.field_key
  `,
    { listId: list.id },
  );
  return { list, fields: fields.map((row) => ({ ...row, values: Number(row.values ?? 0) })) };
}

export async function createTag(
  connection: DuckDBConnection,
  input: { name: string; description?: string; metadata?: unknown },
): Promise<{ id: string; name: string; description?: string }> {
  await ensureWorkspaceSchema(connection);
  const existing = await tagByName(connection, input.name);
  if (existing) return existing;
  const id = randomUUID();
  await connection.run(
    `
    INSERT INTO tags (id, name, description, metadata_json, created_at, updated_at)
    VALUES ($id, $name, $description, $metadata, now(), now())
  `,
    {
      id,
      name: input.name,
      description: input.description ?? null,
      metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
    },
  );
  return { id, name: input.name, description: input.description };
}

export async function addTagToCompany(
  connection: DuckDBConnection,
  input: {
    companyId: string;
    tagName: string;
    value?: string;
    source?: string;
    confidence?: number;
    reason?: string;
  },
): Promise<{ companyId: string; tag: { id: string; name: string } }> {
  await ensureWorkspaceSchema(connection);
  const tag = await createTag(connection, { name: input.tagName });
  await connection.run(
    `
    INSERT OR REPLACE INTO company_tags
      (company_id, tag_id, value, source, confidence, reason, created_at, updated_at)
    VALUES
      ($companyId, $tagId, $value, $source, $confidence, $reason, coalesce(
        (SELECT created_at FROM company_tags WHERE company_id = $companyId AND tag_id = $tagId),
        now()
      ), now())
  `,
    {
      companyId: input.companyId,
      tagId: tag.id,
      value: input.value ?? null,
      source: input.source ?? null,
      confidence: input.confidence ?? null,
      reason: input.reason ?? null,
    },
  );
  return { companyId: input.companyId, tag };
}

export async function removeTagFromCompany(
  connection: DuckDBConnection,
  input: { companyId: string; tagName: string },
): Promise<{ companyId: string; tagName: string; removed: number }> {
  await ensureWorkspaceSchema(connection);
  const tag = await tagByName(connection, input.tagName);
  if (!tag) return { companyId: input.companyId, tagName: input.tagName, removed: 0 };
  const existing = await one(
    connection,
    "SELECT 1 AS exists FROM company_tags WHERE company_id = $companyId AND tag_id = $tagId",
    { companyId: input.companyId, tagId: tag.id },
  );
  await connection.run("DELETE FROM company_tags WHERE company_id = $companyId AND tag_id = $tagId", {
    companyId: input.companyId,
    tagId: tag.id,
  });
  return { companyId: input.companyId, tagName: input.tagName, removed: existing ? 1 : 0 };
}

export async function listTags(
  connection: DuckDBConnection,
  input: { companyId?: string } = {},
): Promise<unknown> {
  await ensureWorkspaceSchema(connection);
  if (input.companyId) {
    const rows = await all(
      connection,
      `
      SELECT t.id, t.name, t.description, ct.value, ct.source, ct.confidence, ct.reason, ct.updated_at
      FROM company_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.company_id = $companyId
      ORDER BY t.name
    `,
      { companyId: input.companyId },
    );
    return { companyId: input.companyId, tags: rows };
  }
  const rows = await all(
    connection,
    `
    SELECT t.id, t.name, t.description, count(ct.company_id)::BIGINT AS companies
    FROM tags t
    LEFT JOIN company_tags ct ON ct.tag_id = t.id
    GROUP BY t.id, t.name, t.description
    ORDER BY t.name
  `,
  );
  return { tags: rows.map((row) => ({ ...row, companies: Number(row.companies ?? 0) })) };
}

export async function tagStats(connection: DuckDBConnection): Promise<unknown> {
  await ensureWorkspaceSchema(connection);
  const rows = await all(
    connection,
    `
    SELECT t.name, count(ct.company_id)::BIGINT AS count
    FROM tags t
    LEFT JOIN company_tags ct ON ct.tag_id = t.id
    GROUP BY t.name
    ORDER BY count DESC, t.name
  `,
  );
  return { tags: countRows(rows, "name") };
}

export async function resolveCompanyId(
  connection: DuckDBConnection,
  input: { companyId?: string; company?: string; country?: string },
): Promise<CandidateCompany> {
  if (input.companyId) {
    const rows = await all(connection, "SELECT * FROM companies WHERE id = $companyId LIMIT 1", {
      companyId: input.companyId,
    });
    if (!rows[0]) throw new Error(`No company found for id ${input.companyId}`);
    return rowToCandidate(rows[0]);
  }
  if (!input.company) throw new Error("Either --company or --company-id is required");
  const matches = await queryCompanies(connection, {
    company: input.company,
    country: input.country,
    limit: COMPANY_RESOLUTION_MATCH_LIMIT,
  });
  if (matches.length === 0) throw new NoCompanyMatchError(input.company, input.country);
  if (matches.length > 1) {
    throw new AmbiguousCompanyMatchError(input.company, matches, input.country, COMPANY_RESOLUTION_MATCH_LIMIT);
  }
  return matches[0];
}

async function getListOrThrow(connection: DuckDBConnection, name: string): Promise<CompanyList> {
  const row = await getList(connection, name);
  if (!row) throw new Error(`List not found: ${name}`);
  return row;
}

async function getList(connection: DuckDBConnection, name: string): Promise<CompanyList | undefined> {
  const row = await one(connection, "SELECT * FROM lists WHERE name = $name", { name });
  return row ? rowToList(row) : undefined;
}

async function tagByName(
  connection: DuckDBConnection,
  name: string,
): Promise<{ id: string; name: string; description?: string } | undefined> {
  const row = await one(connection, "SELECT id, name, description FROM tags WHERE name = $name", { name });
  if (!row) return undefined;
  return { id: text(row.id), name: text(row.name), description: text(row.description) || undefined };
}

async function listFieldValues(connection: DuckDBConnection, listId: string): Promise<Map<string, Record<string, unknown>>> {
  const rows = await all(connection, "SELECT company_id, field_key, value_json FROM list_field_values WHERE list_id = $listId", {
    listId,
  });
  const byCompany = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const companyId = text(row.company_id);
    const fields = byCompany.get(companyId) ?? {};
    fields[text(row.field_key)] = parseJsonValue(row.value_json);
    byCompany.set(companyId, fields);
  }
  return byCompany;
}

async function listMemberTags(
  connection: DuckDBConnection,
  companyIds: string[],
): Promise<Map<string, Array<{ name: string; value?: string; confidence?: number; source?: string; reason?: string }>>> {
  const byCompany = new Map<string, Array<{ name: string; value?: string; confidence?: number; source?: string; reason?: string }>>();
  if (companyIds.length === 0) return byCompany;
  const params: Record<string, string> = {};
  const placeholders = companyIds.map((id, index) => {
    params[`id${index}`] = id;
    return `$id${index}`;
  });
  const rows = await all(
    connection,
    `
    SELECT ct.company_id, t.name, ct.value, ct.source, ct.confidence, ct.reason
    FROM company_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE ct.company_id IN (${placeholders.join(", ")})
    ORDER BY t.name
  `,
    params,
  );
  for (const row of rows) {
    const companyId = text(row.company_id);
    const tags = byCompany.get(companyId) ?? [];
    tags.push({
      name: text(row.name),
      value: text(row.value) || undefined,
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
      source: text(row.source) || undefined,
      reason: text(row.reason) || undefined,
    });
    byCompany.set(companyId, tags);
  }
  return byCompany;
}

async function all(
  connection: DuckDBConnection,
  sql: string,
  params?: DbParams,
): Promise<Record<string, unknown>[]> {
  const reader = params === undefined ? await connection.runAndReadAll(sql) : await connection.runAndReadAll(sql, params);
  return reader.getRowObjectsJS();
}

async function one(
  connection: DuckDBConnection,
  sql: string,
  params?: DbParams,
): Promise<Record<string, unknown> | undefined> {
  return (await all(connection, sql, params))[0];
}

function rowToList(row: Record<string, unknown>): CompanyList {
  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description) || undefined,
    metadata: parseJsonValue(row.metadata_json),
    createdAt: text(row.created_at) || undefined,
    updatedAt: text(row.updated_at) || undefined,
  };
}

function rowToCandidate(row: Record<string, unknown>): CandidateCompany {
  const website = text(row.website);
  return {
    id: text(row.id),
    name: text(row.name),
    website,
    url: website.startsWith("http") ? website : `https://${website}`,
    industry: text(row.industry),
    size: text(row.size),
    country: text(row.country),
    region: text(row.region) || undefined,
    locality: text(row.locality) || undefined,
    linkedinUrl: text(row.linkedin_url) || undefined,
    founded: typeof row.founded === "number" ? row.founded : undefined,
  };
}

function countRows(rows: Record<string, unknown>[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[text(row[key]) || "unknown"] = Number(row.count ?? 0);
  return counts;
}

function parseJsonValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function inferFieldType(value: unknown): string {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  return "string";
}

function positiveInt(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Expected a positive integer, got ${value}`);
  return value;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}
