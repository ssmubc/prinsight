import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRInsight — AI-Powered GitHub PR Intelligence",
  description:
    "Analyze team patterns, predict merge times, and suggest optimal reviewers using ML and Claude.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen text-slate-100 antialiased">
        <header className="sticky top-0 z-40 border-b border-white/5 bg-navy-950/60 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight"
            >
              <Sparkles className="h-5 w-5 text-cyan-400" />
              <span className="text-slate-100">PR</span>
              <span className="gradient-text">Insight</span>
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <Link
                href="/analyze"
                className="rounded-lg px-3 py-2 text-slate-300 transition-colors hover:bg-white/5 hover:text-cyan-300"
              >
                Analyze
              </Link>
              <Link
                href="/predict"
                className="rounded-lg px-3 py-2 text-slate-300 transition-colors hover:bg-white/5 hover:text-cyan-300"
              >
                Predict
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-12">{children}</main>
        <footer className="mt-16 border-t border-white/5 py-8 text-center text-sm text-slate-500">
          Built with MCP · TypeScript · Python · Claude
        </footer>
      </body>
    </html>
  );
}
