# /// script
# requires-python = ">=3.12"
# dependencies = ["river-client==0.10.0"]
# ///
"""Ask the trained guide for the next control, through River's checkpoint chat call.

    # the web app's call: JSON in on stdin, JSON out on stdout
    echo '{"question": "...", "controls": [{"id": "a1", "role": "button", "name": "..."}]}' \
      | RIVER_API_KEY=... uv run --no-project services/guide/choose.py

    # the demo: unseen tasks, base model and trained guide side by side
    RIVER_API_KEY=... uv run --no-project services/guide/choose.py --demo 3

River serves checkpoints over gRPC only, so the web app runs this script rather than an HTTP call.
The checkpoint is the one `train.py` wrote to `runs/latest.json`, or `RIVER_GUIDE_CHECKPOINT`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guide_data  # noqa: E402

RUNS = Path(__file__).resolve().parent / "runs"
SETTINGS = {"temperature": 0, "max_tokens": 64, "chat_template_kwargs": {"enable_thinking": False}}


def served() -> tuple[str, str]:
    latest = json.loads((RUNS / "latest.json").read_text())
    return os.environ.get("RIVER_GUIDE_CHECKPOINT") or latest["checkpoint"], latest["base_model"]


def text_of(result) -> str:
    value = json.loads(result.response_json)["choices"][0]["message"].get("content") or ""
    if isinstance(value, list):
        value = "".join(part.get("text", "") for part in value if isinstance(part, dict))
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", type=int, metavar="N", help="Show N unseen decisions, base and trained")
    args = parser.parse_args()
    if not os.environ.get("RIVER_API_KEY"):
        raise SystemExit("Set RIVER_API_KEY first.")
    import river_client as river

    checkpoint, base_model = served()
    client = river.Client(api_key=os.environ["RIVER_API_KEY"])
    try:
        if args.demo:
            return demo(client, checkpoint, base_model, args.demo)
        request = json.load(sys.stdin)
        prompt = {"goal": request["question"], "walked": request.get("walked", []), "controls": request["controls"]}
        messages = [
            {"role": "system", "content": guide_data.SYSTEM},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ]
        result = client.chat_complete_from_checkpoint(
            messages, checkpoint_path=checkpoint, base_model=base_model, **SETTINGS
        )
        print(json.dumps({"answer": text_of(result), "checkpoint": checkpoint, "base_model": base_model}))
    finally:
        client.close()
    return 0


def demo(client, checkpoint: str, base_model: str, count: int) -> int:
    heldout = guide_data.build()["heldout"]
    step = max(1, len(heldout) // count)
    for decision in heldout[::step][:count]:
        names = {c["id"]: c["name"] for c in decision.controls}
        base = text_of(client.chat_complete(decision.messages(), base_model=base_model, **SETTINGS))
        trained = text_of(
            client.chat_complete_from_checkpoint(
                decision.messages(), checkpoint_path=checkpoint, base_model=base_model, **SETTINGS
            )
        )
        print(f"\ngoal:     {decision.goal}")
        print(f"walked:   {', '.join(decision.prompt['walked']) or '(start)'}")
        print(f"expected: {names[decision.target_id]}")
        for label, text in (("base", base), ("trained", trained)):
            chosen = guide_data.parse_answer(text, decision.controls)
            mark = "correct" if chosen == decision.target_id else "wrong"
            print(f"{label + ':':9} {names.get(chosen, 'invalid answer') if chosen else 'invalid answer'} ({mark})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
