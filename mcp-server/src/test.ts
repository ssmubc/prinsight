import "dotenv/config";
import { GitHubClient } from "./github/client.js";
import {
  fetchPRHistory,
  calculateCodeOwnership,
  getTeamMetrics,
} from "./tools/pr-analyzer.js";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const ok = (msg: string) => console.log(`${c.green}✅ ${msg}${c.reset}`);
const warn = (msg: string) => console.log(`${c.yellow}⚠️  ${msg}${c.reset}`);
const err = (msg: string) => console.log(`${c.red}❌ ${msg}${c.reset}`);
const info = (msg: string) => console.log(`${c.cyan}${msg}${c.reset}`);
const dim = (msg: string) => console.log(`${c.dim}${msg}${c.reset}`);

function header(text: string) {
  console.log(`\n${c.bold}${c.cyan}━━━ ${text} ━━━${c.reset}`);
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const REPO = process.argv[2] || "vercel/next.js";
const SKIP_OWNERSHIP = process.argv.includes("--skip-ownership");
const PR_DAYS = 30;

async function main() {
  console.log(`${c.bold}PRInsight MCP server — pr-analyzer smoke test${c.reset}`);
  info(`Testing on: ${REPO}`);

  if (!process.env.GITHUB_TOKEN) {
    err("GITHUB_TOKEN not set — copy .env.example to .env and add your token");
    process.exit(1);
  }

  const client = new GitHubClient();

  header("Initial rate limit");
  try {
    const rl = await client.checkRateLimit();
    if (rl.remaining < 200) {
      warn(`Only ${rl.remaining} GitHub API calls remaining — this test may be throttled`);
    }
  } catch (e) {
    err(`Rate limit check failed: ${describeError(e)}`);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  header(`fetchPRHistory("${REPO}", ${PR_DAYS})`);
  let prHistory: Awaited<ReturnType<typeof fetchPRHistory>> = [];
  try {
    const start = Date.now();
    prHistory = await fetchPRHistory(REPO, PR_DAYS, client);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    ok(`Fetched ${prHistory.length} merged PRs in ${elapsed}s`);

    if (prHistory.length === 0) {
      warn("No merged PRs in window — skipping per-PR display");
    } else {
      info(`\nFirst 3 PRs:`);
      for (const pr of prHistory.slice(0, 3)) {
        const mergeTime =
          pr.merge_time_hours !== null ? pr.merge_time_hours.toFixed(1) : "—";
        const reviewers = pr.reviewers.length > 0 ? pr.reviewers.join(", ") : "(none)";
        console.log(`${c.cyan}  #${pr.number}${c.reset} ${c.bold}${pr.title}${c.reset}`);
        console.log(`     author:               ${pr.author}`);
        console.log(`     merge_time_hours:     ${mergeTime}`);
        console.log(`     files changed:        ${pr.files.length}`);
        console.log(`     reviewers:            ${reviewers}`);
        console.log(`     review_count:         ${pr.review_comment_count}`);
        console.log(`     +${pr.additions}/-${pr.deletions} across ${pr.commits_count} commits`);
      }
    }
  } catch (e) {
    err(`fetchPRHistory failed: ${describeError(e)}`);
    await client.checkRateLimit().catch(() => undefined);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  header("getTeamMetrics(prHistory)");
  try {
    const metrics = getTeamMetrics(prHistory);
    ok("Computed team metrics");
    const busLabel =
      metrics.bus_factor < 0.3
        ? `${c.green}healthy${c.reset}`
        : `${c.yellow}concerning${c.reset}`;
    info(`  Total PRs analyzed:    ${metrics.total_prs_analyzed}`);
    info(`  Avg merge time:        ${metrics.avg_merge_time_hours.toFixed(2)} hours`);
    info(`  Median merge time:     ${metrics.median_merge_time_hours.toFixed(2)} hours`);
    info(`  Avg reviews per PR:    ${metrics.avg_reviews_per_pr.toFixed(2)}`);
    info(`  Active contributors:   ${metrics.active_contributors}`);
    console.log(
      `${c.cyan}  Bus factor:            ${metrics.bus_factor.toFixed(3)} (${busLabel}${c.cyan})${c.reset}`
    );
  } catch (e) {
    err(`getTeamMetrics failed: ${describeError(e)}`);
  }

  // ──────────────────────────────────────────────────────────
  if (SKIP_OWNERSHIP) {
    header(`calculateCodeOwnership("${REPO}")`);
    console.log(
      `${c.yellow}⏭️  Skipping ownership test (use without --skip-ownership to enable)${c.reset}`
    );
  } else {
    warn(`calculateCodeOwnership on a large repo like ${REPO} can take many`);
    warn(`minutes and consume hundreds-to-thousands of API calls (6mo of commits,`);
    warn(`one getCommit per commit). Press Ctrl-C now to skip.`);

    header(`calculateCodeOwnership("${REPO}")`);
    try {
      const start = Date.now();
      const ownership = await calculateCodeOwnership(REPO, client);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const fileCount = Object.keys(ownership).length;
      ok(`Calculated ownership for ${fileCount} files in ${elapsed}s`);

      const ranked = Object.entries(ownership)
        .map(([file, authors]) => {
          const total = Object.values(authors).reduce((s, n) => s + n, 0);
          return { file, authors, total };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      info(`\nTop 5 most-touched files (last 6 months):`);
      for (const { file, authors, total } of ranked) {
        console.log(`${c.cyan}  ${file}${c.reset} ${c.dim}(${total} commits)${c.reset}`);
        const sortedAuthors = Object.entries(authors).sort((a, b) => b[1] - a[1]);
        for (const [author, count] of sortedAuthors.slice(0, 5)) {
          console.log(`     ${author}: ${count}`);
        }
      }
    } catch (e) {
      err(`calculateCodeOwnership failed: ${describeError(e)}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  header("Final rate limit");
  try {
    const rl = await client.checkRateLimit();
    if (rl.remaining < 100) {
      warn(
        `Only ${rl.remaining} calls left — quota resets at ${rl.resetAt.toISOString()}`
      );
    }
  } catch (e) {
    err(`Final rate limit check failed: ${describeError(e)}`);
  }

  console.log();
  ok("All tests complete");
}

main().catch((e) => {
  err(`Fatal: ${describeError(e)}`);
  process.exit(1);
});
