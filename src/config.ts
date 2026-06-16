import "dotenv/config";

export const DEFAULT_DATASET_PATH =
  process.env.PDL_COMPANY_CSV || "/home/abhi/data/free_company_dataset.csv";

export const TARGET_INDUSTRIES = new Set([
  "construction",
  "electrical/electronic manufacturing",
  "mechanical or industrial engineering",
]);

export const STRICT_SIZE_BUCKETS = new Set([
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
]);

export const LOOSE_SIZE_BUCKETS = new Set(["51-200", ...STRICT_SIZE_BUCKETS]);

export function selectedSizeBuckets(include51200: boolean): Set<string> {
  return include51200 ? LOOSE_SIZE_BUCKETS : STRICT_SIZE_BUCKETS;
}
