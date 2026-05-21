import "dotenv/config";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GitHubClient } from "./github/client.js";
import {
  fetchPRHistory,
  calculateCodeOwnership,
  getTeamMetrics,
} from "./tools/pr-analyzer.js";
import { suggestReviewers } from "./tools/reviewer-suggester.js";
import type { CodeOwnership } from "./types.js";

const log = (...args: unknown[]) => console.error("[prinsight]", ...args);

let sharedClient: GitHubClient | null = null;
function getClient(): GitHubClient {
  if (!sharedClient) {
    sharedClient = new GitHubClient();
  }
  return sharedClient;
}

const OWNERSHIP_TTL_MS = 60 * 60 * 1000;
const ownershipCache = new Map<
  string,
  { data: CodeOwnership; expiresAt: number }
>();

async function getOwnership(repo: string): Promise<CodeOwnership> {
  const now = Date.now();
  const cached = ownershipCache.get(repo);
  if (cached && cached.expiresAt > now) {
    console.error(`[MCP] ownership cache hit for ${repo}`);
    return cached.data;
  }
  console.error(`[MCP] ownership cache miss for ${repo}`);
  const data = await calculateCodeOwnership(repo, getClient());
  ownershipCache.set(repo, { data, expiresAt: now + OWNERSHIP_TTL_MS });
  return data;
}

const PREDICT_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "ml-model",
  "predict.py"
);

const REQUIRED_FEATURES = [
  "files_changed_count",
  "total_lines_changed",
  "commits_count",
  "has_tests",
  "hour_created",
  "day_of_week",
  "author_pr_count",
  "review_count",
  "repo",
];

interface PredictResult {
  risk_level: string;
  probabilities: Record<string, number>;
}

function runPredict(features: Record<string, unknown>): Promise<PredictResult> {
  return new Promise((resolveResult, rejectResult) => {
    const proc = spawn("python3", [PREDICT_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    proc.on("error", (err) => {
      rejectResult(new Error(`failed to spawn python3: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        rejectResult(new Error(`predict.py failed: ${detail}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as PredictResult;
        resolveResult(parsed);
      } catch {
        rejectResult(
          new Error(`predict.py output was not valid JSON: ${stdout.trim()}`)
        );
      }
    });

    proc.stdin.write(JSON.stringify(features));
    proc.stdin.end();
  });
}

const TOOLS: Tool[] = [
  {
    name: "analyze_pr_history",
    description: "Fetch and analyze PR history",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in the form 'owner/name'",
        },
        days: {
          type: "number",
          description: "How many days of PR history to fetch",
        },
      },
      required: ["repo", "days"],
    },
  },
  {
    name: "get_code_ownership",
    description: "Calculate code ownership by file",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in the form 'owner/name'",
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "predict_pr_risk",
    description: "Predict PR merge time using ML",
    inputSchema: {
      type: "object",
      properties: {
        pr_features: {
          type: "object",
          description: "Feature object describing the PR (size, files, author, etc.)",
        },
      },
      required: ["pr_features"],
    },
  },
  {
    name: "suggest_reviewers",
    description: "Suggest optimal reviewers",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in the form 'owner/name'",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Files changed in the PR",
        },
        current_reviewers: {
          type: "array",
          items: { type: "string" },
          description: "Reviewers already assigned (will be excluded)",
        },
        pr_author: {
          type: "string",
          description:
            "PR author username (will be excluded from suggestions). Optional.",
        },
      },
      required: ["repo", "files", "current_reviewers"],
    },
  },
  {
    name: "get_team_metrics",
    description: "Calculate team health metrics",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in the form 'owner/name'",
        },
      },
      required: ["repo"],
    },
  },
];

async function main() {
  const server = new Server(
    { name: "prinsight-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    console.error(`[MCP] ${name} called with params:`, args);

    switch (name) {
      case "analyze_pr_history": {
        try {
          const repo = String(args.repo);
          const days = Number(args.days);
          const result = await fetchPRHistory(repo, days, getClient());
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`tool 'analyze_pr_history' failed:`, message);
          return {
            content: [
              { type: "text", text: `Error in 'analyze_pr_history': ${message}` },
            ],
            isError: true,
          };
        }
      }

      case "get_code_ownership": {
        try {
          const repo = String(args.repo);
          const result = await getOwnership(repo);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`tool 'get_code_ownership' failed:`, message);
          return {
            content: [
              { type: "text", text: `Error in 'get_code_ownership': ${message}` },
            ],
            isError: true,
          };
        }
      }

      case "get_team_metrics": {
        try {
          const repo = String(args.repo);
          const prHistory = await fetchPRHistory(repo, 90, getClient());
          const metrics = getTeamMetrics(prHistory);
          return {
            content: [{ type: "text", text: JSON.stringify(metrics) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`tool 'get_team_metrics' failed:`, message);
          return {
            content: [
              { type: "text", text: `Error in 'get_team_metrics': ${message}` },
            ],
            isError: true,
          };
        }
      }

      case "predict_pr_risk": {
        try {
          const features = args.pr_features as
            | Record<string, unknown>
            | undefined;
          if (!features || typeof features !== "object") {
            throw new Error("'pr_features' must be an object");
          }
          const missing = REQUIRED_FEATURES.filter((f) => !(f in features));
          if (missing.length > 0) {
            throw new Error(
              `missing required feature(s): ${missing.join(", ")}`
            );
          }
          const result = await runPredict(features);
          console.error(`[MCP] predict_pr_risk:`, {
            repo: features.repo,
            risk_level: result.risk_level,
            probabilities: result.probabilities,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`tool 'predict_pr_risk' failed:`, message);
          return {
            content: [
              { type: "text", text: `Error in 'predict_pr_risk': ${message}` },
            ],
            isError: true,
          };
        }
      }

      case "suggest_reviewers": {
        try {
          const repo = String(args.repo);
          const files = Array.isArray(args.files)
            ? args.files.map(String)
            : [];
          const currentReviewers = Array.isArray(args.current_reviewers)
            ? args.current_reviewers.map(String)
            : [];
          const prAuthor =
            typeof args.pr_author === "string" && args.pr_author.length > 0
              ? args.pr_author
              : undefined;
          if (files.length === 0) {
            throw new Error("'files' must be a non-empty array");
          }

          const ownership = await getOwnership(repo);
          const suggestions = suggestReviewers(
            repo,
            files,
            currentReviewers,
            ownership,
            prAuthor
          );
          console.error(`[MCP] suggest_reviewers:`, {
            repo,
            file_count: files.length,
            pr_author: prAuthor,
            suggested: suggestions.map((s) => s.reviewer),
          });
          return {
            content: [{ type: "text", text: JSON.stringify(suggestions) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`tool 'suggest_reviewers' failed:`, message);
          return {
            content: [
              { type: "text", text: `Error in 'suggest_reviewers': ${message}` },
            ],
            isError: true,
          };
        }
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  if (process.env.GITHUB_TOKEN) {
    try {
      await getClient().checkRateLimit();
    } catch (error) {
      log("rate limit check skipped:", error instanceof Error ? error.message : error);
    }
  } else {
    log("GITHUB_TOKEN not set — tools that hit the GitHub API will fail until it is configured.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server ready on stdio transport");
}

main().catch((error) => {
  console.error("[prinsight] fatal:", error);
  process.exit(1);
});
