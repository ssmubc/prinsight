import { GitHubClient } from "../github/client.js";
import type { PRData, CodeOwnership, TeamMetrics } from "../types.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SIX_MONTHS_DAYS = 180;
const PR_PROGRESS_INTERVAL = 10;
const COMMIT_PROGRESS_INTERVAL = 50;

const log = (...args: unknown[]) => console.error("[pr-analyzer]", ...args);

function parseRepo(repo: string): { owner: string; name: string } {
  if (typeof repo !== "string") {
    throw new Error(`Invalid repo: expected string, got ${typeof repo}`);
  }
  const parts = repo.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: '${repo}' — expected 'owner/name'`);
  }
  return { owner: parts[0], name: parts[1] };
}

async function reportApiError(error: unknown, client: GitHubClient): Promise<never> {
  const message = client.handleError(error);
  log("API error:", message);
  if (message.toLowerCase().includes("rate limit")) {
    try {
      await client.checkRateLimit();
    } catch {
      // best-effort secondary diagnostic — ignore
    }
  }
  throw new Error(message);
}

export async function fetchPRHistory(
  repo: string,
  days: number = 90,
  client: GitHubClient = new GitHubClient()
): Promise<PRData[]> {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid days: ${days} — must be a positive number`);
  }
  const { owner, name } = parseRepo(repo);
  const cutoff = new Date(Date.now() - days * DAY_MS);
  log(`Fetching closed PRs for ${repo} updated since ${cutoff.toISOString()}`);

  try {
    const closedPRs = await client.withRetry(() =>
      client.octokit.paginate(
        client.octokit.pulls.list,
        {
          owner,
          repo: name,
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: 100,
        },
        (response, done) => {
          const items: Array<{
            number: number;
            updated_at: string;
            merged_at: string | null;
          }> = [];
          for (const pr of response.data) {
            if (new Date(pr.updated_at) < cutoff) {
              done();
              break;
            }
            items.push({
              number: pr.number,
              updated_at: pr.updated_at,
              merged_at: pr.merged_at,
            });
          }
          return items;
        }
      )
    );

    const merged = closedPRs.filter(
      (pr) => pr.merged_at && new Date(pr.merged_at) >= cutoff
    );
    log(`Found ${merged.length} merged PRs in window; fetching details...`);

    const results: PRData[] = [];
    for (let i = 0; i < merged.length; i++) {
      const pr = merged[i];
      const position = i + 1;
      if (position % PR_PROGRESS_INTERVAL === 0 || position === merged.length) {
        log(`Fetching PR ${position}/${merged.length}...`);
      }

      const [fullPR, files, reviews] = await Promise.all([
        client.withRetry(() =>
          client.octokit.pulls.get({ owner, repo: name, pull_number: pr.number })
        ),
        client.withRetry(() =>
          client.octokit.paginate(client.octokit.pulls.listFiles, {
            owner,
            repo: name,
            pull_number: pr.number,
            per_page: 100,
          })
        ),
        client.withRetry(() =>
          client.octokit.paginate(client.octokit.pulls.listReviews, {
            owner,
            repo: name,
            pull_number: pr.number,
            per_page: 100,
          })
        ),
      ]);

      const data = fullPR.data;
      const author = data.user?.login ?? "unknown";
      const reviewers = Array.from(
        new Set(
          reviews
            .map((r) => r.user?.login)
            .filter((login): login is string => !!login && login !== author)
        )
      );

      const createdMs = new Date(data.created_at).getTime();
      const mergedMs = data.merged_at ? new Date(data.merged_at).getTime() : null;
      const mergeTimeHours =
        mergedMs !== null ? (mergedMs - createdMs) / HOUR_MS : null;

      results.push({
        number: data.number,
        title: data.title,
        author,
        created_at: data.created_at,
        merged_at: data.merged_at,
        merge_time_hours: mergeTimeHours,
        files: files.map((f) => f.filename),
        reviewers,
        review_comment_count: reviews.length,
        commits_count: data.commits,
        additions: data.additions,
        deletions: data.deletions,
      });
    }

    results.sort((a, b) => {
      const aMs = a.merged_at ? new Date(a.merged_at).getTime() : 0;
      const bMs = b.merged_at ? new Date(b.merged_at).getTime() : 0;
      return bMs - aMs;
    });

    log(`Returning ${results.length} PRData entries`);
    return results;
  } catch (error) {
    await reportApiError(error, client);
    throw error;
  }
}

export async function calculateCodeOwnership(
  repo: string,
  client: GitHubClient = new GitHubClient()
): Promise<CodeOwnership> {
  const { owner, name } = parseRepo(repo);
  const since = new Date(Date.now() - SIX_MONTHS_DAYS * DAY_MS).toISOString();
  log(`Calculating code ownership for ${repo} since ${since}`);

  try {
    const commits = await client.withRetry(() =>
      client.octokit.paginate(client.octokit.repos.listCommits, {
        owner,
        repo: name,
        since,
        per_page: 100,
      })
    );
    log(`Found ${commits.length} commits to analyze`);

    const ownership: CodeOwnership = {};
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const position = i + 1;
      if (
        position % COMMIT_PROGRESS_INTERVAL === 0 ||
        position === commits.length
      ) {
        log(`Processing commit ${position}/${commits.length}...`);
      }

      const author =
        commit.author?.login ?? commit.commit?.author?.name ?? "unknown";

      const detail = await client.withRetry(() =>
        client.octokit.repos.getCommit({
          owner,
          repo: name,
          ref: commit.sha,
        })
      );

      for (const file of detail.data.files ?? []) {
        const path = file.filename;
        if (!ownership[path]) ownership[path] = {};
        ownership[path][author] = (ownership[path][author] ?? 0) + 1;
      }
    }

    return ownership;
  } catch (error) {
    await reportApiError(error, client);
    throw error;
  }
}

export function getTeamMetrics(prHistory: PRData[]): TeamMetrics {
  if (!Array.isArray(prHistory)) {
    throw new Error("getTeamMetrics requires an array of PRData");
  }

  if (prHistory.length === 0) {
    return {
      avg_merge_time_hours: 0,
      median_merge_time_hours: 0,
      avg_reviews_per_pr: 0,
      total_prs_analyzed: 0,
      active_contributors: 0,
      bus_factor: 0,
    };
  }

  const mergeTimes = prHistory
    .map((pr) => pr.merge_time_hours)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const avgMergeTime =
    mergeTimes.length > 0
      ? mergeTimes.reduce((sum, v) => sum + v, 0) / mergeTimes.length
      : 0;

  const sortedTimes = [...mergeTimes].sort((a, b) => a - b);
  let medianMergeTime = 0;
  if (sortedTimes.length > 0) {
    const mid = Math.floor(sortedTimes.length / 2);
    medianMergeTime =
      sortedTimes.length % 2 === 0
        ? (sortedTimes[mid - 1] + sortedTimes[mid]) / 2
        : sortedTimes[mid];
  }

  const avgReviews =
    prHistory.reduce((sum, pr) => sum + pr.review_comment_count, 0) /
    prHistory.length;

  const authors = new Set(prHistory.map((pr) => pr.author));

  const fileAuthors = new Map<string, Set<string>>();
  for (const pr of prHistory) {
    for (const f of pr.files) {
      let authorSet = fileAuthors.get(f);
      if (!authorSet) {
        authorSet = new Set();
        fileAuthors.set(f, authorSet);
      }
      authorSet.add(pr.author);
    }
  }

  const totalFiles = fileAuthors.size;
  const lowOwnership = Array.from(fileAuthors.values()).filter(
    (set) => set.size <= 2
  ).length;
  const busFactor = totalFiles === 0 ? 0 : lowOwnership / totalFiles;

  return {
    avg_merge_time_hours: avgMergeTime,
    median_merge_time_hours: medianMergeTime,
    avg_reviews_per_pr: avgReviews,
    total_prs_analyzed: prHistory.length,
    active_contributors: authors.size,
    bus_factor: busFactor,
  };
}
