import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

type CsvRow = Record<string, string>;

type Args = {
  input: string;
  outDir: string;
  prompt: string;
  limit?: number;
  company?: string;
};

const defaultInput = "output/experiments/water-valves/water-valves-shortlist-leads-summary.csv";
const defaultOutDir = "packages/deepresearch/results/water-valves";
const defaultPrompt = "packages/deepresearch/prompts/manufacturing-outreach-research.md";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: defaultInput,
    outDir: defaultOutDir,
    prompt: defaultPrompt,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    const [key, inlineValue] = token.startsWith("--") ? token.split("=", 2) : [token, undefined];
    const value = inlineValue ?? argv[i + 1];

    if (key === "--input") {
      args.input = requiredValue(key, value);
      if (inlineValue === undefined) i += 1;
    } else if (key === "--out-dir") {
      args.outDir = requiredValue(key, value);
      if (inlineValue === undefined) i += 1;
    } else if (key === "--prompt") {
      args.prompt = requiredValue(key, value);
      if (inlineValue === undefined) i += 1;
    } else if (key === "--limit") {
      args.limit = Number.parseInt(requiredValue(key, value), 10);
      if (!Number.isFinite(args.limit) || args.limit < 1) {
        throw new Error("--limit must be a positive integer");
      }
      if (inlineValue === undefined) i += 1;
    } else if (key === "--company") {
      args.company = requiredValue(key, value).toLowerCase();
      if (inlineValue === undefined) i += 1;
    } else if (key === "--help" || key === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  return args;
}

function requiredValue(key: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${key} requires a value`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Prepare runner-neutral deep-research prompts from a shortlist CSV.

Usage:
  pnpm --filter @fcdx/deepresearch prepare:input -- [options]

Options:
  --input <path>      Shortlist CSV to read.
                      Default: ${defaultInput}
  --out-dir <path>    Folder for generated task files.
                      Default: ${defaultOutDir}
  --prompt <path>     Research prompt template.
                      Default: ${defaultPrompt}
  --limit <n>         Only generate the first n matching tasks.
  --company <text>    Only generate tasks whose company name contains text.

Examples:
  pnpm --filter @fcdx/deepresearch prepare:input -- --limit 1
  pnpm --filter @fcdx/deepresearch prepare:input -- --company "kennedy valve"
`);
}

function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...records] = rows;
  if (!header) return [];

  return records.map((record) => {
    const parsed: CsvRow = {};
    header.forEach((name, index) => {
      parsed[name] = record[index] ?? "";
    });
    return parsed;
  });
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function compact(row: CsvRow, key: string): string {
  const value = row[key]?.trim();
  return value && value.length > 0 ? value : "unknown";
}

function buildCompanyContext(row: CsvRow): string {
  const context: Array<[string, string]> = [
    ["id", compact(row, "id")],
    ["name", compact(row, "name")],
    ["website", compact(row, "website")],
    ["size", compact(row, "size")],
    ["industry", compact(row, "industry")],
    ["region", compact(row, "region")],
    ["locality", compact(row, "locality")],
    ["existing_product_catalog_answer", compact(row, "product_catalog_answer")],
    ["existing_product_catalog_summary", compact(row, "product_catalog_summary")],
    ["existing_product_catalog_evidence", compact(row, "product_catalog_evidence")],
    ["selected_lead_name", compact(row, "selected_name")],
    ["selected_lead_role", compact(row, "selected_role")],
    ["selected_lead_linkedin_url", compact(row, "selected_linkedin_url")],
    ["selected_lead_reason", compact(row, "selected_reason")],
    ["verified_email", compact(row, "verified_email")],
    ["verified_email_status", compact(row, "verified_email_status")],
  ];

  return context.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function buildTask(prompt: string, row: CsvRow): string {
  return `${prompt.trim()}

## Company Input

${buildCompanyContext(row)}
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = await findRepoRoot(process.cwd());
  const inputPath = resolveFromRoot(repoRoot, args.input);
  const outDir = resolveFromRoot(repoRoot, args.outDir);
  const taskDir = path.join(outDir, "tasks");
  const promptPath = resolveFromRoot(repoRoot, args.prompt);

  const [csvText, prompt] = await Promise.all([
    readFile(inputPath, "utf8"),
    readFile(promptPath, "utf8"),
  ]);

  let rows = parseCsv(csvText);
  if (args.company) {
    rows = rows.filter((row) => row.name?.toLowerCase().includes(args.company ?? ""));
  }
  if (args.limit !== undefined) {
    rows = rows.slice(0, args.limit);
  }
  if (rows.length === 0) {
    throw new Error("No rows matched the provided input/options");
  }

  await mkdir(taskDir, { recursive: true });

  const manifest: Array<Record<string, string>> = [];
  const jsonl: string[] = [];
  const batchParts: string[] = [];

  for (const row of rows) {
    const companyName = compact(row, "name");
    const id = compact(row, "id");
    const slug = `${slugify(companyName)}-${id.slice(0, 8)}`;
    const task = buildTask(prompt, row);
    const taskFile = path.join(taskDir, `${slug}.md`);

    await writeFile(taskFile, task, "utf8");
    manifest.push({
      id,
      name: companyName,
      website: compact(row, "website"),
      task_file: path.relative(outDir, taskFile),
    });
    jsonl.push(JSON.stringify({
      id,
      name: companyName,
      website: compact(row, "website"),
      task_file: taskFile,
      prompt: task,
    }));
    batchParts.push(`# Task: ${companyName}\n\n${task}`);
  }

  const manifestCsv = [
    "id,name,website,task_file",
    ...manifest.map((row) => [
      csvEscape(row.id),
      csvEscape(row.name),
      csvEscape(row.website),
      csvEscape(row.task_file),
    ].join(",")),
  ].join("\n");

  await Promise.all([
    writeFile(path.join(outDir, "manifest.csv"), `${manifestCsv}\n`, "utf8"),
    writeFile(path.join(outDir, "tasks.jsonl"), `${jsonl.join("\n")}\n`, "utf8"),
    writeFile(path.join(outDir, "batch.md"), `${batchParts.join("\n\n---\n\n")}\n`, "utf8"),
    writeFile(path.join(outDir, "codex-baseline-prompt.md"), `${batchParts[0]}\n`, "utf8"),
    writeFile(path.join(outDir, "README.md"), buildRunReadme(rows.length, inputPath, promptPath), "utf8"),
  ]);

  console.log(JSON.stringify({
    input: inputPath,
    prompt: promptPath,
    rows: rows.length,
    outDir,
    manifest: path.join(outDir, "manifest.csv"),
    tasksJsonl: path.join(outDir, "tasks.jsonl"),
    batch: path.join(outDir, "batch.md"),
    codexBaselinePrompt: path.join(outDir, "codex-baseline-prompt.md"),
  }, null, 2));
}

async function findRepoRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try {
      await access(path.join(current, "pnpm-workspace.yaml"), constants.F_OK);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(start);
      }
      current = parent;
    }
  }
}

function resolveFromRoot(root: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(root, maybeRelative);
}

function buildRunReadme(count: number, inputPath: string, promptPath: string): string {
  return `# Water Valves Deep Research Run

Generated ${count} deep-research task(s).

- Source CSV: \`${inputPath}\`
- Prompt template: \`${promptPath}\`
- \`tasks/\`: one Markdown prompt per company
- \`tasks.jsonl\`: JSONL manifest with full prompt text for tool ingestion
- \`batch.md\`: all tasks concatenated for agents that accept a single Markdown input
- \`codex-baseline-prompt.md\`: first task only, intended for a quick fresh-Codex comparison

## Runner Usage

Use \`batch.md\` for a batch run if the configured research runner supports long-context batch tasks. For a safer smoke test, feed one file from \`tasks/\` into the runner first.

The intended comparison is:

1. Run one company through a research runner and save the report under a runner-specific folder.
2. Run the same task through a fresh Codex agent and save the report under \`codex-baseline-reports/\`.
3. Compare elapsed time, number of external searches/pages opened, and report quality for outreach usefulness.
`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
