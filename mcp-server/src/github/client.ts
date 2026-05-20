import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export class GitHubClient {
  public readonly octokit: Octokit;

  constructor(token?: string) {
    const authToken = token ?? process.env.GITHUB_TOKEN;
    if (!authToken) {
      throw new Error(
        "GITHUB_TOKEN is required — set it in your environment or pass it to the constructor."
      );
    }
    this.octokit = new Octokit({ auth: authToken });
  }

  async checkRateLimit(): Promise<{
    remaining: number;
    limit: number;
    resetAt: Date;
  }> {
    const { data } = await this.octokit.rateLimit.get();
    const core = data.resources.core;
    const resetAt = new Date(core.reset * 1000);
    console.error(
      `[GitHub] Rate limit: ${core.remaining}/${core.limit} remaining (resets ${resetAt.toISOString()})`
    );
    return { remaining: core.remaining, limit: core.limit, resetAt };
  }

  handleError(error: unknown): string {
    if (error instanceof RequestError) {
      const status = error.status;
      const message = error.message;
      if (status === 401) {
        return `GitHub auth failed (401): check your GITHUB_TOKEN — ${message}`;
      }
      if (status === 403) {
        const isRateLimit = message.toLowerCase().includes("rate limit");
        return isRateLimit
          ? `GitHub rate limit hit (403): ${message}`
          : `GitHub forbidden (403): ${message}`;
      }
      if (status === 404) {
        return `GitHub resource not found (404): ${message}`;
      }
      return `GitHub API error (${status}): ${message}`;
    }
    if (error instanceof Error) {
      return `Unexpected error: ${error.message}`;
    }
    return `Unknown error: ${String(error)}`;
  }

  async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 5;
    const initialDelayMs = options.initialDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 60_000;

    let attempt = 0;
    let delay = initialDelayMs;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        const isRetryable = this.isRetryable(error);
        if (!isRetryable || attempt >= maxRetries) {
          throw error;
        }

        const waitMs = this.computeWaitMs(error, delay, maxDelayMs);
        console.error(
          `[GitHub] Retryable error on attempt ${attempt + 1}/${maxRetries}: ${this.handleError(
            error
          )} — waiting ${waitMs}ms`
        );
        await this.sleep(waitMs);
        attempt += 1;
        delay = Math.min(delay * 2, maxDelayMs);
      }
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof RequestError) {
      if (error.status === 403 && error.message.toLowerCase().includes("rate limit")) {
        return true;
      }
      if (error.status === 429) return true;
      if (error.status >= 500 && error.status < 600) return true;
    }
    return false;
  }

  private computeWaitMs(error: unknown, baseDelay: number, max: number): number {
    if (error instanceof RequestError) {
      const reset = error.response?.headers?.["x-ratelimit-reset"];
      if (typeof reset === "string") {
        const resetMs = parseInt(reset, 10) * 1000 - Date.now();
        if (Number.isFinite(resetMs) && resetMs > 0) {
          return Math.min(resetMs + 1000, max);
        }
      }
      const retryAfter = error.response?.headers?.["retry-after"];
      if (typeof retryAfter === "string") {
        const seconds = parseInt(retryAfter, 10);
        if (Number.isFinite(seconds) && seconds > 0) {
          return Math.min(seconds * 1000, max);
        }
      }
    }
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(baseDelay + jitter, max);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
