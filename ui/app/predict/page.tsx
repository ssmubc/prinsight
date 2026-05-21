"use client";

import { useState } from "react";
import { GitPullRequest, Copy, Check, AlertCircle } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { RiskBadge } from "@/components/RiskBadge";
import { LoadingProgress } from "@/components/LoadingProgress";

const STEPS = [
  "Fetching PR metadata from GitHub",
  "Extracting ML features",
  "Calling XGBoost classifier",
  "Computing reviewer suggestions (code ownership)",
  "Calling Claude Opus 4.7 for synthesis",
];

type Risk = "LOW" | "MEDIUM" | "HIGH";

interface PredictResult {
  summary: string;
  risk_level: Risk;
  probabilities: Record<string, number>;
}

export default function PredictPage() {
  const [repo, setRepo] = useState("");
  const [prNumber, setPrNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(prNumber, 10);
    if (!repo.trim() || !Number.isFinite(n)) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: repo.trim(), prNumber: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyMarkdown() {
    if (!result?.summary) return;
    await navigator.clipboard.writeText(result.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const confidence = result
    ? result.probabilities[result.risk_level]
    : undefined;

  return (
    <div className="animate-fade-in space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <GitPullRequest className="h-7 w-7 text-cyan-400" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">
            PR Predictor
          </h1>
        </div>
        <p className="text-slate-400">
          XGBoost classifier + ownership-ranked reviewer suggestions, summarized
          by Claude.
        </p>
      </div>

      <form onSubmit={onSubmit} className="glass animate-slide-up space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <label className="block text-sm font-medium text-slate-300">
            Repository
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name"
              className="input mt-2"
              disabled={loading}
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-300">
            PR Number
            <input
              type="number"
              value={prNumber}
              onChange={(e) => setPrNumber(e.target.value)}
              placeholder="12345"
              className="input mt-2"
              disabled={loading}
              required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={loading || !repo.trim() || !prNumber}
          className="btn-primary"
        >
          {loading ? "Predicting…" : "Predict PR Risk"}
        </button>
        <p className="text-xs text-slate-500">
          Note: reviewer suggestions require a code-ownership scan (cached per
          repo for 1h). First call on a new repo can take several minutes.
        </p>
      </form>

      {error && (
        <div className="glass flex items-start gap-3 border-rose-400/30 bg-rose-500/5 p-5 animate-slide-up">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
          <div className="flex-1">
            <div className="font-semibold text-rose-300">Prediction failed</div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-sm text-rose-200/80">
              {error}
            </pre>
          </div>
        </div>
      )}

      {loading && <LoadingProgress steps={STEPS} estimatedSecondsPerStep={45} />}

      {result && !loading && (
        <div className="space-y-6 animate-slide-up">
          {/* Risk badge + probability bars */}
          <div className="glass space-y-5 p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <RiskBadge risk={result.risk_level} confidence={confidence} />
              <div className="text-xs text-slate-500">
                {repo}#{prNumber}
              </div>
            </div>
            <ProbabilityBars probabilities={result.probabilities} active={result.risk_level} />
          </div>

          {/* Markdown summary */}
          <div className="glass space-y-4 p-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-100">
                Summary
              </h2>
              <button
                onClick={copyMarkdown}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-cyan-300"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <Markdown>{result.summary}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

function ProbabilityBars({
  probabilities,
  active,
}: {
  probabilities: Record<string, number>;
  active: string;
}) {
  const order = ["LOW", "MEDIUM", "HIGH"];
  const colors: Record<string, string> = {
    LOW: "from-emerald-500 to-teal-500",
    MEDIUM: "from-amber-500 to-orange-500",
    HIGH: "from-rose-500 to-red-500",
  };
  return (
    <div className="space-y-2">
      {order.map((cls) => {
        const p = probabilities[cls] ?? 0;
        const pct = Math.round(p * 1000) / 10;
        return (
          <div key={cls} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span
                className={`font-semibold ${
                  cls === active ? "text-slate-100" : "text-slate-500"
                }`}
              >
                {cls}
              </span>
              <span
                className={`tabular-nums ${
                  cls === active ? "text-slate-200" : "text-slate-500"
                }`}
              >
                {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${colors[cls]} transition-all`}
                style={{ width: `${pct}%`, opacity: cls === active ? 1 : 0.4 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
