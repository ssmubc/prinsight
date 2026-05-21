#!/usr/bin/env python3
"""Predict PR risk class from feature JSON. Reads from argv[1] or stdin."""
import json
import sys
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).parent
MODEL_PATH = ROOT / "pr_risk_model.pkl"


def main() -> int:
    if not MODEL_PATH.exists():
        print(
            f"error: model not found at {MODEL_PATH} — run train.py first",
            file=sys.stderr,
        )
        return 1

    bundle = joblib.load(MODEL_PATH)
    model = bundle["model"]
    features = bundle["features"]
    classes = bundle["classes"]
    repo_columns = bundle.get("repo_columns", {})
    numeric_features = [f for f in features if f not in repo_columns.values()]

    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON input — {e}", file=sys.stderr)
        return 1

    missing = [f for f in numeric_features if f not in payload]
    if missing:
        print(f"error: missing features: {missing}", file=sys.stderr)
        return 1

    row = {f: payload[f] for f in numeric_features}
    if isinstance(row["has_tests"], bool):
        row["has_tests"] = int(row["has_tests"])
    user_repo = payload.get("repo", "")
    for repo, col in repo_columns.items():
        row[col] = 1 if user_repo == repo else 0
    df = pd.DataFrame([row])[features]

    proba = model.predict_proba(df)[0]
    pred_idx = int(proba.argmax())
    result = {
        "risk_level": classes[pred_idx],
        "probabilities": {
            c: round(float(p), 4) for c, p in zip(classes, proba)
        },
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
