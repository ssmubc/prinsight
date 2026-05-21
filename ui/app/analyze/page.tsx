"use client";

import { useState } from "react";
import { BarChart3, Copy, Check, AlertCircle, Download } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { LoadingProgress } from "@/components/LoadingProgress";

const STEPS = [
  "Fetching closed PRs (last 90 days)",
  "Computing team metrics",
  "Walking 6 months of commits for code ownership",
  "Trimming ownership map to top files",
  "Calling Claude Opus 4.7 for synthesis",
];

export default function AnalyzePage() {
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: repo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAnalysis(data.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyMarkdown() {
    if (!analysis) return;
    await navigator.clipboard.writeText(analysis);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadMarkdown() {
    if (!analysis) return;
    const blob = new Blob([analysis], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${repo.replace("/", "_")}-analysis.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-fade-in space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-cyan-400" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">
            Repository Analyzer
          </h1>
        </div>
        <p className="text-slate-400">
          90 days of PR data, full team metrics, and code-ownership map → an
          executive briefing for the repo.
        </p>
      </div>

      <form onSubmit={onSubmit} className="glass animate-slide-up space-y-4 p-6">
        <label className="block text-sm font-medium text-slate-300">
          Repository
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name (e.g. vercel/next.js)"
            className="input mt-2"
            disabled={loading}
            required
          />
        </label>
        <button type="submit" disabled={loading || !repo.trim()} className="btn-primary">
          {loading ? "Analyzing…" : "Analyze Repository"}
        </button>
        <p className="text-xs text-slate-500">
          ⚠ This calls the agent, which computes 6 months of code ownership — it
          can take 5–15 minutes on large repos and consumes hundreds of GitHub
          API calls. Stick to smaller / personal repos for the demo.
        </p>
      </form>

      {error && (
        <div className="glass flex items-start gap-3 border-rose-400/30 bg-rose-500/5 p-5 animate-slide-up">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
          <div className="flex-1">
            <div className="font-semibold text-rose-300">Analysis failed</div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-sm text-rose-200/80">
              {error}
            </pre>
          </div>
        </div>
      )}

      {loading && <LoadingProgress steps={STEPS} estimatedSecondsPerStep={60} />}

      {analysis && !loading && (
        <div className="glass animate-slide-up space-y-4 p-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-100">Analysis</h2>
            <div className="flex items-center gap-2">
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
              <button
                onClick={downloadMarkdown}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-cyan-300"
              >
                <Download className="h-4 w-4" />
                Download .md
              </button>
            </div>
          </div>
          <Markdown>{analysis}</Markdown>
        </div>
      )}
    </div>
  );
}
