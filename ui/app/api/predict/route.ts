import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

export const runtime = "nodejs";
export const maxDuration = 1800;

const PROJECT_ROOT = resolve(process.cwd(), "..");
const AGENT_DIR = resolve(PROJECT_ROOT, "agent");

loadEnv({ path: resolve(PROJECT_ROOT, ".env") });

interface PredictPayload {
  summary: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  probabilities: Record<string, number>;
  suggestions: unknown;
  pr_metadata: { number: number; title: string; author: string };
}

function runAgent(args: string[]): Promise<string> {
  return new Promise((resolveResult, rejectResult) => {
    const proc = spawn(
      "node",
      ["--loader", "ts-node/esm", "index.ts", ...args],
      {
        cwd: AGENT_DIR,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err) => rejectResult(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-15).join("\n");
        rejectResult(new Error(`Agent exited ${code}\n${tail}`));
        return;
      }
      resolveResult(stdout.trim());
    });
  });
}

export async function POST(req: NextRequest) {
  let body: { repo?: unknown; prNumber?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const prNumber = Number(body.prNumber);

  if (!repo.includes("/") || repo.split("/").length !== 2) {
    return NextResponse.json(
      { error: "repo must be in form 'owner/name'" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return NextResponse.json(
      { error: "prNumber must be a positive integer" },
      { status: 400 }
    );
  }

  try {
    const stdout = await runAgent([
      "predict",
      repo,
      String(prNumber),
      "--json",
    ]);
    const result = JSON.parse(stdout) as PredictPayload;
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
