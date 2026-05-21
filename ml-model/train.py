"""Train XGBoost classifier on PR risk levels (LOW/MEDIUM/HIGH)."""
import json
from pathlib import Path

import joblib
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split

# PRs idle for more than 30 days are abandoned/stale and muddy the HIGH class.
MAX_MERGE_HOURS = 720

ROOT = Path(__file__).parent
DATA_PATH = ROOT / "training_data.json"
MODEL_PATH = ROOT / "pr_risk_model.pkl"

NUMERIC_FEATURES = [
    "files_changed_count",
    "total_lines_changed",
    "commits_count",
    "has_tests",
    "hour_created",
    "day_of_week",
    "author_pr_count",
    "review_count",
]

REPO_CATEGORIES = [
    "vercel/next.js",
    "facebook/react",
    "microsoft/typescript",
    "nodejs/node",
    "vuejs/core",
]


def _repo_col(repo: str) -> str:
    return "repo_" + repo.replace("/", "_").replace(".", "_")


REPO_COLUMNS = {r: _repo_col(r) for r in REPO_CATEGORIES}
FEATURE_ORDER = NUMERIC_FEATURES + list(REPO_COLUMNS.values())

# Class label order — index == XGBoost class id.
CLASSES = ["LOW", "MEDIUM", "HIGH"]


def risk_label(hours: float) -> str:
    if hours < 24:
        return "LOW"
    if hours <= 168:
        return "MEDIUM"
    return "HIGH"


def load_data():
    with open(DATA_PATH) as f:
        raw = json.load(f)
    df = pd.DataFrame([r["features"] for r in raw])
    df["has_tests"] = df["has_tests"].astype(int)
    for repo, col in REPO_COLUMNS.items():
        df[col] = (df["repo"] == repo).astype(int)
    X = df[FEATURE_ORDER]
    y = pd.Series([r["target"] for r in raw], name="merge_time_hours")
    return X, y


def main():
    print(f"Loading training data from {DATA_PATH}")
    X, y_hours = load_data()
    print(f"  {len(X)} examples, {X.shape[1]} features")

    keep = y_hours <= MAX_MERGE_HOURS
    removed = int((~keep).sum())
    X = X.loc[keep].reset_index(drop=True)
    y_hours = y_hours.loc[keep].reset_index(drop=True)
    print(f"  Filtered {removed} outliers (>30 days), keeping {len(y_hours)} examples")

    labels = pd.Series([risk_label(h) for h in y_hours], name="risk")
    y = pd.Series([CLASSES.index(label) for label in labels], name="risk_id")
    dist = {c: int((labels == c).sum()) for c in CLASSES}
    print("  Class distribution: " + ", ".join(f"{c}={dist[c]}" for c in CLASSES))

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"  Train: {len(X_train)}, Test: {len(X_test)}")

    print("\nTraining XGBoost classifier...")
    model = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=5,
        learning_rate=0.1,
        random_state=42,
        objective="multi:softprob",
        num_class=len(CLASSES),
    )
    model.fit(X_train, y_train)

    print("\nEvaluating on test set...")
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, average="macro")
    pred_labels = [CLASSES[int(i)] for i in preds]
    test_labels = [CLASSES[int(i)] for i in y_test]

    importances = sorted(
        zip(FEATURE_ORDER, model.feature_importances_),
        key=lambda kv: kv[1],
        reverse=True,
    )

    print("\n━━━ Training summary ━━━")
    print(f"  Examples:           {len(X)}")
    print(f"  Train / Test:       {len(X_train)} / {len(X_test)}")
    print(f"  Accuracy:           {acc:.4f}")
    print(f"  Macro F1:           {f1:.4f}")
    print("\nPer-class report:")
    print(
        classification_report(
            test_labels, pred_labels, labels=CLASSES, zero_division=0
        )
    )
    print("Top 5 feature importances:")
    for name, imp in importances[:5]:
        print(f"  {name:30s} {imp:.4f}")

    joblib.dump(
        {
            "model": model,
            "features": FEATURE_ORDER,
            "classes": CLASSES,
            "repo_columns": REPO_COLUMNS,
            "task": "classification",
        },
        MODEL_PATH,
    )
    print(f"\nModel saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
