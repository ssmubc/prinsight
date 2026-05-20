import "dotenv/config";
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

const log = (...args: unknown[]) => console.error("[prinsight]", ...args);

let sharedClient: GitHubClient | null = null;
function getClient(): GitHubClient {
  if (!sharedClient) {
    sharedClient = new GitHubClient();
  }
  return sharedClient;
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
          const result = await calculateCodeOwnership(repo, getClient());
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

      case "predict_pr_risk":
      case "suggest_reviewers":
        return {
          content: [
            {
              type: "text",
              text: `Tool '${name}' is registered but not yet implemented (planned for Day 2). Args: ${JSON.stringify(
                args
              )}`,
            },
          ],
        };

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
