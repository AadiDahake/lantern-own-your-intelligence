# /// script
# requires-python = ">=3.12"
# dependencies = ["river-client==0.10.0"]
# ///
"""Compare the base model and the trained guide on the held-out sessions, the unseen tasks.

    RIVER_API_KEY=... uv run --no-project services/guide/eval.py [--run <id>]

Both systems get the same prompts with `temperature=0`. A decision is correct when the answer
names the control the visitor really pressed next. An answer that is not JSON, or names an id
that is not on the page, is invalid. Writes `runs/<id>/eval.json` and `runs/<id>/eval.md`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guide_data  # noqa: E402

RUNS = Path(__file__).resolve().parent / "runs"
SETTINGS = {"temperature": 0, "max_tokens": 64, "chat_template_kwargs": {"enable_thinking": False}}


def answer_text(result) -> str:
    choice = json.loads(result.response_json)["choices"][0]
    value = choice["message"].get("content") or ""
    if isinstance(value, list):
        value = "".join(part.get("text", "") for part in value if isinstance(part, dict))
    return value


def score(rows: list[dict]) -> dict:
    by_kind: dict[str, list[bool]] = defaultdict(list)
    for row in rows:
        by_kind[row["kind"]].append(row["correct"])
    n = len(rows)
    return {
        "decisions": n,
        "accuracy": round(sum(r["correct"] for r in rows) / n, 4),
        "invalid_rate": round(sum(r["chosen"] is None for r in rows) / n, 4),
        "accuracy_by_kind": {k: round(sum(v) / len(v), 4) for k, v in sorted(by_kind.items())},
        "mean_seconds": round(sum(r["seconds"] for r in rows) / n, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="Run id under runs/; default is runs/latest.json")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if not os.environ.get("RIVER_API_KEY"):
        raise SystemExit("Set RIVER_API_KEY before evaluating.")

    latest = json.loads((RUNS / "latest.json").read_text())
    run_id = args.run or latest["run_id"]
    metrics = json.loads((RUNS / run_id / "metrics.json").read_text())
    base_model = metrics["base_model"]
    checkpoint = metrics["checkpoint"]["inference"]
    heldout = guide_data.build()["heldout"]

    import river_client as river

    client = river.Client(api_key=os.environ["RIVER_API_KEY"])

    def ask(system: str, decision: guide_data.Decision) -> dict:
        started = time.monotonic()
        try:
            if system == "base":
                result = client.chat_complete(decision.messages(), base_model=base_model, **SETTINGS)
            else:
                result = client.chat_complete_from_checkpoint(
                    decision.messages(), checkpoint_path=checkpoint, base_model=base_model, **SETTINGS
                )
            text = answer_text(result)
        except Exception as error:  # a failed call counts as an invalid answer, never as a skip
            text = f"error: {type(error).__name__}: {error}"
        chosen = guide_data.parse_answer(text, decision.controls)
        return {
            "session_id": decision.session_id,
            "goal": decision.goal,
            "kind": decision.target_kind,
            "target": decision.target_id,
            "chosen": chosen,
            "correct": chosen == decision.target_id,
            "answer": text[:200],
            "seconds": round(time.monotonic() - started, 3),
        }

    results = {}
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for system in ("base", "trained"):
                rows = list(pool.map(lambda d, s=system: ask(s, d), heldout))
                results[system] = {"summary": score(rows), "rows": rows}
                print(system, json.dumps(results[system]["summary"]), flush=True)
    finally:
        client.close()

    report = {
        "run_id": run_id,
        "base_model": base_model,
        "checkpoint": checkpoint,
        "unseen_tasks": {
            "what": "held-out sessions: no decision of these walks is in the training data",
            "sessions": len({d.session_id for d in heldout}),
            "decisions": len(heldout),
        },
        "settings": SETTINGS,
        "base": results["base"]["summary"],
        "trained": results["trained"]["summary"],
        "rows": {k: v["rows"] for k, v in results.items()},
    }
    out = RUNS / run_id
    (out / "eval.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "eval.md").write_text(markdown(report, metrics))
    print(f"wrote {out / 'eval.json'} and {out / 'eval.md'}")
    return 0


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def markdown(report: dict, metrics: dict) -> str:
    base, trained = report["base"], report["trained"]
    kinds = sorted(set(base["accuracy_by_kind"]) | set(trained["accuracy_by_kind"]))
    losses = [s["loss"] for s in metrics["steps"]]
    lines = [
        f"# Lantern guide model, run {report['run_id']}",
        "",
        f"Base model `{report['base_model']}`, LoRA rank {metrics['lora_rank']}, "
        f"{len(metrics['steps'])} train steps on {metrics['train_decisions']} decisions "
        f"from {metrics['train_sessions']} high reward walks.",
        "",
        f"Unseen tasks: {report['unseen_tasks']['decisions']} decisions from "
        f"{report['unseen_tasks']['sessions']} held-out sessions. Temperature 0.",
        "",
        "| Metric | Base model | Trained guide |",
        "|---|---|---|",
        f"| Next control correct | {pct(base['accuracy'])} | {pct(trained['accuracy'])} |",
        f"| Invalid answer | {pct(base['invalid_rate'])} | {pct(trained['invalid_rate'])} |",
    ]
    for kind in kinds:
        lines.append(
            f"| Correct, {kind} step | {pct(base['accuracy_by_kind'].get(kind, 0))} "
            f"| {pct(trained['accuracy_by_kind'].get(kind, 0))} |"
        )
    lines += [
        f"| Mean seconds per decision | {base['mean_seconds']} | {trained['mean_seconds']} |",
        "",
        "Training loss by step: " + ", ".join(f"{loss:.4f}" if loss is not None else "n/a" for loss in losses),
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
