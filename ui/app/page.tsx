import Link from "next/link";
import { BarChart3, GitPullRequest, ArrowRight, Cpu, Users, Clock } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="space-y-20 animate-fade-in">
      {/* Hero */}
      <section className="space-y-6 pt-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-1.5 text-xs font-medium text-cyan-300">
          <Cpu className="h-3.5 w-3.5" />
          <span>ML · Multi-Agent Orchestration · MCP</span>
        </div>
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
          <span className="gradient-text">PRInsight</span>
        </h1>
        <p className="text-xl font-medium text-slate-200 sm:text-2xl">
          AI-Powered GitHub PR Intelligence
        </p>
        <p className="mx-auto max-w-2xl text-base text-slate-400">
          Analyze team patterns, predict merge times, and suggest optimal
          reviewers — powered by XGBoost classification and Claude reasoning
          over a custom MCP server.
        </p>
      </section>

      {/* Feature cards */}
      <section className="grid gap-6 md:grid-cols-2">
        <FeatureCard
          href="/analyze"
          icon={<BarChart3 className="h-6 w-6" />}
          title="Repository Analyzer"
          description="Survey 90 days of PR activity, calculate code ownership, and surface team bottlenecks. Get an executive summary with prioritized recommendations."
          highlights={[
            { icon: <Users className="h-4 w-4" />, text: "Team health metrics" },
            { icon: <BarChart3 className="h-4 w-4" />, text: "Code ownership map" },
            { icon: <Clock className="h-4 w-4" />, text: "Merge-time distribution" },
          ]}
          cta="Analyze a repo"
        />
        <FeatureCard
          href="/predict"
          icon={<GitPullRequest className="h-6 w-6" />}
          title="PR Predictor"
          description="Classify a PR's merge-time risk (LOW/MEDIUM/HIGH) with calibrated probabilities, plus reviewer suggestions ranked by code ownership."
          highlights={[
            { icon: <Cpu className="h-4 w-4" />, text: "XGBoost classifier" },
            { icon: <Users className="h-4 w-4" />, text: "Owner-aware reviewers" },
            { icon: <Clock className="h-4 w-4" />, text: "Trained on 596 real PRs" },
          ]}
          cta="Predict a PR"
        />
      </section>

      {/* Stack credit */}
      <section className="glass p-8 text-center">
        <h2 className="mb-2 text-lg font-semibold text-slate-100">Under the hood</h2>
        <p className="mx-auto max-w-2xl text-sm text-slate-400">
          A TypeScript MCP server exposes 5 tools (analyze_pr_history,
          get_code_ownership, predict_pr_risk, suggest_reviewers,
          get_team_metrics) over stdio JSON-RPC. A Python XGBoost classifier
          handles risk prediction. A Claude Opus 4.7 agent orchestrates the
          tools and synthesizes the final analysis.
        </p>
      </section>
    </div>
  );
}

function FeatureCard({
  href,
  icon,
  title,
  description,
  highlights,
  cta,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  highlights: { icon: React.ReactNode; text: string }[];
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="glass glass-hover group flex flex-col gap-5 p-8 animate-slide-up"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 text-cyan-300 ring-1 ring-cyan-400/20">
        {icon}
      </div>
      <div className="space-y-2">
        <h3 className="text-2xl font-bold text-slate-100">{title}</h3>
        <p className="text-sm leading-relaxed text-slate-400">{description}</p>
      </div>
      <ul className="space-y-2">
        {highlights.map((h, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
            <span className="text-cyan-400">{h.icon}</span>
            <span>{h.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center gap-2 text-sm font-medium text-cyan-300 transition-transform group-hover:translate-x-1">
        {cta}
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );
}
