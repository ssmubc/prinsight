import type { CodeOwnership, ReviewerSuggestion } from "../types.js";

const BOT_PATTERNS = ["bot", "[bot]", "dependabot"];
const OWNERSHIP_WEIGHT = 0.7;
const RECENCY_WEIGHT = 0.3;
const RECENCY_SATURATION_COMMITS = 10;
const MAX_DIRS_IN_REASON = 3;
const TOP_N = 3;

function isBot(username: string): boolean {
  const lower = username.toLowerCase();
  return BOT_PATTERNS.some((pattern) => lower.includes(pattern));
}

function dirPrefix(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? filePath : filePath.substring(0, idx + 1);
}

export function suggestReviewers(
  _repo: string,
  prFiles: string[],
  currentReviewers: string[],
  codeOwnership: CodeOwnership,
  prAuthor?: string
): ReviewerSuggestion[] {
  if (prFiles.length === 0) return [];

  // Tally per-author signal across the PR's files
  const ownedFiles = new Map<string, string[]>();
  const commitCounts = new Map<string, number>();

  for (const file of prFiles) {
    const owners = codeOwnership[file];
    if (!owners) continue;
    for (const [author, count] of Object.entries(owners)) {
      const filesForAuthor = ownedFiles.get(author) ?? [];
      filesForAuthor.push(file);
      ownedFiles.set(author, filesForAuthor);
      commitCounts.set(author, (commitCounts.get(author) ?? 0) + count);
    }
  }

  const excluded = new Set(currentReviewers);
  if (prAuthor) excluded.add(prAuthor);
  const candidates: ReviewerSuggestion[] = [];

  for (const [author, files] of ownedFiles.entries()) {
    if (excluded.has(author) || isBot(author)) continue;

    const ownershipScore = files.length / prFiles.length;
    const commits = commitCounts.get(author) ?? 0;
    const recencyScore = Math.min(commits / RECENCY_SATURATION_COMMITS, 1);
    const confidence =
      OWNERSHIP_WEIGHT * ownershipScore + RECENCY_WEIGHT * recencyScore;

    const dirs = Array.from(new Set(files.map(dirPrefix)));
    const sampleDirs = dirs.slice(0, MAX_DIRS_IN_REASON).join(", ");
    const pct = Math.round(ownershipScore * 100);
    const reason = `Owns ${pct}% of changes (${sampleDirs})`;

    candidates.push({ reviewer: author, reason, confidence });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, TOP_N);
}
