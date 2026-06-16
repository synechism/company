import fs from "node:fs";
import readline from "node:readline";
import { Command } from "commander";
import type { CandidateCompany, CompanyRecord } from "../types.js";
import { DEFAULT_DATASET_PATH } from "../config.js";
import { streamCompanyCsv } from "../data/csv.js";

const program = new Command()
  .description("Check whether domains appear in the filtered candidate JSONL and full CSV.")
  .requiredOption("-d, --domain <domain...>", "Domain or URL to check")
  .option("-c, --candidates <path>", "Candidate JSONL path", "output/candidates/strict.jsonl")
  .option("-i, --input <path>", "Full PDL company CSV path", DEFAULT_DATASET_PATH)
  .parse(process.argv);

const options = program.opts<{
  domain: string[];
  candidates: string;
  input: string;
}>();

const wanted = options.domain.map((domain) => ({
  input: domain,
  host: hostKey(domain),
}));

const candidateMatches: Record<string, CandidateCompany[]> = Object.fromEntries(
  wanted.map(({ host }) => [host, []]),
);
const datasetMatches: Record<string, CompanyRecord[]> = Object.fromEntries(
  wanted.map(({ host }) => [host, []]),
);

for (const candidate of await readCandidates(options.candidates)) {
  const candidateHost = hostKey(candidate.url || candidate.website);
  for (const { host } of wanted) {
    if (candidateHost === host || candidateHost.endsWith(`.${host}`)) {
      candidateMatches[host].push(candidate);
    }
  }
}

for await (const record of streamCompanyCsv(options.input)) {
  const website = String(record.website ?? "");
  const recordHost = hostKey(website);
  const haystack = `${record.name ?? ""} ${record.linkedin_url ?? ""} ${website}`.toLowerCase();
  for (const { host } of wanted) {
    const compact = host.replace(/\./g, "");
    if (
      recordHost === host ||
      recordHost.endsWith(`.${host}`) ||
      haystack.includes(host) ||
      haystack.includes(compact)
    ) {
      datasetMatches[host].push(record);
    }
  }
}

console.log(
  JSON.stringify(
    wanted.map(({ input, host }) => ({
      input,
      normalizedHost: host,
      inCandidates: candidateMatches[host].length > 0,
      candidateMatches: candidateMatches[host],
      inDataset: datasetMatches[host].length > 0,
      datasetMatches: datasetMatches[host].slice(0, 20),
      datasetMatchCount: datasetMatches[host].length,
    })),
    null,
    2,
  ),
);

async function readCandidates(pathname: string): Promise<CandidateCompany[]> {
  if (!fs.existsSync(pathname)) return [];
  const stream = fs.createReadStream(pathname, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: CandidateCompany[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as CandidateCompany);
  }

  return rows;
}

function hostKey(urlOrHost: string): string {
  try {
    const url = new URL(urlOrHost.startsWith("http") ? urlOrHost : `https://${urlOrHost}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlOrHost.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  }
}
