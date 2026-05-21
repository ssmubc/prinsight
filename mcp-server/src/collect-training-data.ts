import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "./github/client.js";
import { fetchPRHistory } from "./tools/pr-analyzer.js";
import type { PRData } from "./types.js";

const REPOS = [
  "vercel/next.js",
  "facebook/react",
  "microsoft/typescript",
  "nodejs/node",
  "vuejs/core",
];
const DAYS = 30;
const TEST_PATTERNS = ["test", "__tests__", ".test.", ".spec."];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "ml-model",
  "training_data.json"
);

interface TrainingExample {
  features: {
    files_changed_count: number;
    total_lines_changed: number;
    commits_count: number;
    has_tests: boolean;
    hour_created: number;
    day_of_week: number;
    author_pr_count: number;
    review_count: number;
    repo: string;
  };
  target: number;
}

function hasTests(files: string[]): boolean {
  return files.some((f) => {
    const lower = f.toLowerCase();
    return TEST_PATTERNS.some((p) => lower.includes(p));
  });
}

function buildExample(
  pr: PRData,
  repo: string,
  authorCounts: Map<string, number>
): TrainingExample | null {
  if (pr.merge_time_hours === null || !Number.isFinite(pr.merge_time_hours)) {
    return null;
  }
  const created = new Date(pr.created_at);
  return {
    features: {
      files_changed_count: pr.files.length,
      total_lines_changed: pr.additions + pr.deletions,
      commits_count: pr.commits_count,
      has_tests: hasTests(pr.files),
      hour_created: created.getUTCHours(),
      day_of_week: created.getUTCDay(),
      author_pr_count: authorCounts.get(pr.author) ?? 0,
      review_count: pr.reviewers.length,
      repo,
    },
    target: pr.merge_time_hours,
  };
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN not set in .env — aborting");
    process.exit(1);
  }

  const client = new GitHubClient();
  console.log("Initial rate limit:");
  await client.checkRateLimit();

  const allPRs: Array<{ pr: PRData; repo: string }> = [];
  const failures: Array<{ repo: string; reason: string }> = [];

  for (let i = 0; i < REPOS.length; i++) {
    const repo = REPOS[i];
    console.log(`\nCollecting from repo ${i + 1}/${REPOS.length}: ${repo}`);
    try {
      const prs = await fetchPRHistory(repo, DAYS, client);
      console.log(`  Found ${prs.length} PRs`);
      for (const pr of prs) allPRs.push({ pr, repo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ❌ Failed: ${msg}`);
      failures.push({ repo, reason: msg });
    }
  }

  const authorCounts = new Map<string, number>();
  for (const { pr } of allPRs) {
    authorCounts.set(pr.author, (authorCounts.get(pr.author) ?? 0) + 1);
  }

  const examples: TrainingExample[] = [];
  for (const { pr, repo } of allPRs) {
    const example = buildExample(pr, repo, authorCounts);
    if (example) examples.push(example);
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(examples, null, 2));

  console.log(`\n━━━ Summary ━━━`);
  console.log(`Total PRs collected:   ${allPRs.length}`);
  console.log(`Training examples:     ${examples.length}`);
  console.log(`Unique authors:        ${authorCounts.size}`);
  console.log(`Output written to:     ${OUTPUT_PATH}`);

  if (examples.length > 0) {
    const targets = examples.map((e) => e.target);
    const min = Math.min(...targets);
    const max = Math.max(...targets);
    const mean = targets.reduce((s, v) => s + v, 0) / targets.length;
    console.log(`\nmerge_time_hours statistics:`);
    console.log(`  min:    ${min.toFixed(2)}`);
    console.log(`  max:    ${max.toFixed(2)}`);
    console.log(`  mean:   ${mean.toFixed(2)}`);
  }

  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} repo(s) failed:`);
    for (const f of failures) {
      console.log(`  - ${f.repo}: ${f.reason}`);
    }
  }

  console.log(`\nFinal rate limit:`);
  await client.checkRateLimit();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
