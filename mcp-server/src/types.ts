export interface PRData {
  number: number;
  title: string;
  author: string;
  created_at: string;
  merged_at: string | null;
  merge_time_hours: number | null;
  files: string[];
  reviewers: string[];
  review_comment_count: number;
  commits_count: number;
  additions: number;
  deletions: number;
}

export interface CodeOwnership {
  [file_path: string]: {
    [author: string]: number;
  };
}

export interface TeamMetrics {
  avg_merge_time_hours: number;
  median_merge_time_hours: number;
  avg_reviews_per_pr: number;
  total_prs_analyzed: number;
  active_contributors: number;
  bus_factor: number;
}

export interface ReviewerSuggestion {
  reviewer: string;
  reason: string;
  confidence: number;
}

export interface PRFeatures {
  additions: number;
  deletions: number;
  files_changed: number;
  commits_count: number;
  author: string;
  hour_of_day?: number;
  day_of_week?: number;
}
