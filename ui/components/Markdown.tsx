"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-slate max-w-none prose-headings:text-slate-100 prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-xl prose-h3:text-cyan-300 prose-h3:mt-6 prose-p:text-slate-300 prose-p:leading-relaxed prose-strong:text-cyan-300 prose-strong:font-semibold prose-li:text-slate-300 prose-li:marker:text-cyan-400 prose-code:text-emerald-300 prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-cyan-300 prose-a:no-underline hover:prose-a:underline prose-hr:border-white/10">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
