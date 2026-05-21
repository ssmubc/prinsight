import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_DIR = resolve(__dirname, "..", "mcp-server");

const log = (...args: unknown[]) => console.error("[agent]", ...args);

// ─────────────────────────────────────────────────────────────────────────
// MCP client — spawns the MCP server and speaks line-delimited JSON-RPC 2.0
// over its stdio (the MCP protocol's stdio transport).
// ─────────────────────────────────────────────────────────────────────────

interface MCPResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

class MCPClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = "";

  async start(): Promise<void> {
    log("spawning MCP server subprocess...");
    this.proc = spawn(
      "node",
      ["--loader", "ts-node/esm", "src/index.ts"],
      {
        cwd: MCP_SERVER_DIR,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      }
    );

    this.proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    this.proc.on("error", (err) =>
      log("server process error:", err.message)
    );
    this.proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        log(`server process exited with code ${code}`);
      }
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "prinsight-agent", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    log("MCP server initialized");
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    log(`MCP tools/call → ${name}`);
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as MCPToolResult;

    const text =
      result.content.find((c) => c.type === "text")?.text ?? "";

    if (result.isError) {
      throw new Error(`MCP tool '${name}' failed: ${text || "unknown error"}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) throw new Error("MCP client not started");
    return new Promise((resolveFn, rejectFn) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveFn, reject: rejectFn });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params?: unknown): void {
    this.send({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
  }

  private send(msg: unknown): void {
    this.proc?.stdin.write(JSON.stringify(msg) + "\n");
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: MCPResponse;
      try {
        msg = JSON.parse(trimmed) as MCPResponse;
      } catch {
        log("ignoring non-JSON line on stdout:", trimmed.slice(0, 200));
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          handler.reject(
            new Error(msg.error.message ?? `error code ${msg.error.code}`)
          );
        } else {
          handler.resolve(msg.result);
        }
      }
    }
  }

  close(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Claude — single-call analyses with adaptive thinking + high effort.
// Caching skipped: system prompt is well under the 4096-token cacheable
// minimum on Opus 4.7, so cache_control markers would be no-ops.
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_ANALYZE = `You are a GitHub team analyst. You receive PR history, team metrics, and code-ownership data for a repository and provide concise, actionable analysis for engineering managers. Cite specific numbers from the data when making claims.`;

const SYSTEM_PREDICT = `You are a PR triage assistant. You receive an ML risk prediction and reviewer suggestions for a single pull request and summarize them with concrete reasoning for the PR author and reviewers.`;

async function callClaude(system: string, userMessage: string): Promise<string> {
  const anthropic = new Anthropic();
  log("calling Claude (claude-opus-4-7, adaptive thinking, effort=high)...");
  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    system,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    messages: [{ role: "user", content: userMessage }],
  });

  log(
    `Claude usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`
  );

  return response.content
    .filter(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text"
    )
    .map((b) => b.text)
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers: ownership trimming, test detection, PR feature extraction
// ─────────────────────────────────────────────────────────────────────────

function truncateOwnership(
  ownership: Record<string, Record<string, number>>,
  topN: number
): { trimmed: Record<string, Record<string, number>>; totalFiles: number } {
  const ranked = Object.entries(ownership)
    .map(([file, authors]) => ({
      file,
      authors,
      total: Object.values(authors).reduce((s, n) => s + n, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);
  const trimmed: Record<string, Record<string, number>> = {};
  for (const r of ranked) trimmed[r.file] = r.authors;
  return { trimmed, totalFiles: Object.keys(ownership).length };
}

function hasTests(files: string[]): boolean {
  const patterns = ["test", "__tests__", ".test.", ".spec."];
  return files.some((f) => {
    const lower = f.toLowerCase();
    return patterns.some((p) => lower.includes(p));
  });
}

async function extractPRFeatures(
  repo: string,
  prNumber: number,
  octokit: Octokit
): Promise<{
  pr_metadata: {
    number: number;
    title: string;
    author: string;
    created_at: string;
    files: string[];
    current_reviewers: string[];
  };
  ml_features: {
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
}> {
  const [owner, name] = repo.split("/");
  log(`fetching ${repo}#${prNumber} from GitHub...`);

  const [prResp, files, reviews] = await Promise.all([
    octokit.pulls.get({ owner, repo: name, pull_number: prNumber }),
    octokit.paginate(octokit.pulls.listFiles, {
      owner,
      repo: name,
      pull_number: prNumber,
      per_page: 100,
    }),
    octokit.paginate(octokit.pulls.listReviews, {
      owner,
      repo: name,
      pull_number: prNumber,
      per_page: 100,
    }),
  ]);

  const pr = prResp.data;
  const filePaths = files.map((f) => f.filename);
  const author = pr.user?.login ?? "unknown";

  log(`fetching PR count for author '${author}' in ${repo}...`);
  const authorPRs = await octokit.search.issuesAndPullRequests({
    q: `repo:${repo} type:pr author:${author}`,
    per_page: 1,
  });

  const reviewerCount = new Set(
    reviews
      .map((r) => r.user?.login)
      .filter((l): l is string => !!l && l !== author)
  ).size;

  const created = new Date(pr.created_at);
  const currentReviewers =
    pr.requested_reviewers?.map((r) => r.login).filter((l): l is string => !!l) ?? [];

  return {
    pr_metadata: {
      number: pr.number,
      title: pr.title,
      author,
      created_at: pr.created_at,
      files: filePaths,
      current_reviewers: currentReviewers,
    },
    ml_features: {
      files_changed_count: filePaths.length,
      total_lines_changed: pr.additions + pr.deletions,
      commits_count: pr.commits,
      has_tests: hasTests(filePaths),
      hour_created: created.getUTCHours(),
      day_of_week: created.getUTCDay(),
      author_pr_count: authorPRs.data.total_count,
      review_count: reviewerCount,
      repo,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Public functions
// ─────────────────────────────────────────────────────────────────────────

export async function analyzeRepository(repo: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not set");
  }

  const mcp = new MCPClient();
  await mcp.start();
  try {
    log(`analyze_pr_history(${repo}, 90)...`);
    const prHistory = (await mcp.callTool("analyze_pr_history", {
      repo,
      days: 90,
    })) as unknown[];
    log(`  → ${prHistory.length} PRs`);

    log(`get_team_metrics(${repo})...`);
    const metrics = await mcp.callTool("get_team_metrics", { repo });

    log(
      `get_code_ownership(${repo}) — this fetches 6 months of commits and may take several minutes...`
    );
    const ownership = (await mcp.callTool("get_code_ownership", {
      repo,
    })) as Record<string, Record<string, number>>;
    const { trimmed, totalFiles } = truncateOwnership(ownership, 50);
    log(`  → ${totalFiles} files (trimmed to top 50 for prompt)`);

    const userMessage = `Repository: ${repo}

Team Metrics:
${JSON.stringify(metrics, null, 2)}

PR History (last 90 days, ${prHistory.length} PRs):
${JSON.stringify(prHistory, null, 2)}

Code Ownership (top 50 most-touched files; ${totalFiles} total files):
${JSON.stringify(trimmed, null, 2)}

Provide:
1. **Executive summary** (2-3 sentences)
2. **Key metrics** and what they indicate about team health
3. **Bottlenecks or risks** identified
4. **Top 3 actionable recommendations**

Format as markdown.`;

    return await callClaude(SYSTEM_ANALYZE, userMessage);
  } finally {
    mcp.close();
  }
}

export interface PredictResult {
  summary: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  probabilities: Record<string, number>;
  suggestions: unknown;
  pr_metadata: {
    number: number;
    title: string;
    author: string;
  };
}

export async function predictPR(repo: string, prNumber: number): Promise<PredictResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not set");
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const { pr_metadata, ml_features } = await extractPRFeatures(
    repo,
    prNumber,
    octokit
  );

  const mcp = new MCPClient();
  await mcp.start();
  try {
    log("predict_pr_risk...");
    const prediction = (await mcp.callTool("predict_pr_risk", {
      pr_features: ml_features,
    })) as { risk_level: "LOW" | "MEDIUM" | "HIGH"; probabilities: Record<string, number> };

    log(
      "suggest_reviewers... (this fetches code ownership and may take several minutes on first call)"
    );
    const suggestions = await mcp.callTool("suggest_reviewers", {
      repo,
      files: pr_metadata.files,
      current_reviewers: pr_metadata.current_reviewers,
      pr_author: pr_metadata.author,
    });

    const userMessage = `PR: ${repo}#${pr_metadata.number}
Title: ${pr_metadata.title}
Author: ${pr_metadata.author}
Created: ${pr_metadata.created_at}
Files changed (${pr_metadata.files.length}): ${pr_metadata.files.slice(0, 20).join(", ")}${pr_metadata.files.length > 20 ? " …" : ""}

ML Features:
${JSON.stringify(ml_features, null, 2)}

ML Prediction:
${JSON.stringify(prediction, null, 2)}

Reviewer Suggestions:
${JSON.stringify(suggestions, null, 2)}

Provide a summary:
- **Predicted risk level** and confidence
- **Key factors** driving the prediction
- **Recommended reviewers** with reasoning
- **Any concerns or red flags**

Format as markdown.`;

    const summary = await callClaude(SYSTEM_PREDICT, userMessage);
    return {
      summary,
      risk_level: prediction.risk_level,
      probabilities: prediction.probabilities,
      suggestions,
      pr_metadata: {
        number: pr_metadata.number,
        title: pr_metadata.title,
        author: pr_metadata.author,
      },
    };
  } finally {
    mcp.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.error("Usage:");
  console.error("  node agent/index.js analyze <repo> [--json]");
  console.error("  node agent/index.js predict <repo> <pr_number> [--json]");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const [command, ...rest] = positional;

  try {
    if (command === "analyze") {
      const repo = rest[0];
      if (!repo) {
        printUsage();
        process.exit(1);
      }
      const analysis = await analyzeRepository(repo);
      if (jsonMode) {
        console.log(JSON.stringify({ analysis }));
      } else {
        console.log("\n" + analysis);
      }
    } else if (command === "predict") {
      const repo = rest[0];
      const prNumber = parseInt(rest[1] ?? "", 10);
      if (!repo || !Number.isFinite(prNumber)) {
        printUsage();
        process.exit(1);
      }
      const result = await predictPR(repo, prNumber);
      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else {
        console.log("\n" + result.summary);
      }
    } else {
      printUsage();
      process.exit(1);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("fatal:", message);
    process.exit(1);
  }
}

main();
