# /// script
# requires-python = ">=3.12"
# dependencies = ["river-client==0.10.0"]
# ///
"""Train the Lantern guide model: a LoRA on a River base model that lights the next control.

    RIVER_API_KEY=... uv run --no-project services/guide/train.py
    uv run --no-project services/guide/train.py --dry-run     # data only, no key, no network

The examples come from the scored fixture sessions (`guide_data.py`). Only walks with a high
reward are kept, and each example's token weights are scaled by that reward. One session in four
is held out as an unseen task for `eval.py`. The run writes `runs/<id>/metrics.json` with the
loss of every train step and `runs/latest.json` with the checkpoint the web app serves.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guide_data  # noqa: E402

RUNS = Path(__file__).resolve().parent / "runs"
PREFERRED_MODELS = ["Qwen/Qwen3.6-35B-A3B-FP8", "Qwen/Qwen3.8-27B-FP8"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", help="River base model; default is the first enabled of " + ", ".join(PREFERRED_MODELS))
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--dry-run", action="store_true", help="Build and print the data, call nothing")
    return parser.parse_args()


def choose_model(client, requested: str | None) -> str:
    if requested:
        return requested
    enabled = set(client.get_capabilities())
    for name in PREFERRED_MODELS:
        if name in enabled:
            return name
    raise SystemExit(f"None of {PREFERRED_MODELS} is enabled for this key. Enabled: {sorted(enabled)}")


def main() -> int:
    args = parse_args()
    data = guide_data.build()
    train = data["train"]
    summary = {k: v for k, v in data.items() if not isinstance(v, list)}
    summary |= {"train_decisions": len(train), "heldout_decisions": len(data["heldout"])}
    print(json.dumps(summary))
    if args.dry_run:
        example = train[0]
        print(json.dumps(example.messages() + [{"role": "assistant", "content": example.answer()}], indent=1))
        return 0
    if not os.environ.get("RIVER_API_KEY"):
        raise SystemExit("Set RIVER_API_KEY before training.")

    import river_client as river
    from river_client.renderers import TrainOnWhat, get_renderer

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = RUNS / run_id
    run_dir.mkdir(parents=True)
    client = river.Client(api_key=os.environ["RIVER_API_KEY"])
    try:
        model_name = choose_model(client, args.model)
        print(f"base model: {model_name}", flush=True)
        renderer = get_renderer(model_name, thinking=False)

        batch_data = []
        for decision in train:
            example = renderer.build_training_example(
                decision.messages() + [{"role": "assistant", "content": decision.answer()}],
                train_on=TrainOnWhat.LAST_ASSISTANT,
                train_on_eos=True,
                max_length=None,
            ).to_dict()
            # to_dict makes one example's weights sum to 1.0; the walk's reward scales the example.
            example["weights"] = [w * decision.reward.scalar for w in example["weights"]]
            batch_data.append(example)

        order = []
        for epoch in range(args.epochs):
            shuffled = batch_data[:]
            random.Random(epoch).shuffle(shuffled)
            order += shuffled
        total_steps = math.ceil(len(order) / args.batch)

        metrics = {
            "run_id": run_id,
            "base_model": model_name,
            "lora_rank": args.lora_rank,
            "lr": args.lr,
            "batch": args.batch,
            "epochs": args.epochs,
            "loss_fn": "cross_entropy",
            "reward": "0.7 * (completion - 1) / 4 + 0.3 * (coherence - 1) / 4, kept when total >= "
            + str(guide_data.MIN_TOTAL),
            **summary,
            "steps": [],
        }
        with client.session(experiment="lantern-guide") as session:
            model = session.create_model(base_model=model_name, lora=river.LoraConfig(rank=args.lora_rank))
            for step in range(total_steps):
                batch = order[step * args.batch : (step + 1) * args.batch]
                started = time.monotonic()
                # Never retried: a train_step that timed out may still have applied.
                forward, optim = model.train_step(batch, lr=args.lr, loss_fn="cross_entropy", grad_clip_norm=1.0)
                loss = forward.metrics.get("loss_mean", forward.metrics.get("loss"))
                record = {
                    "step": step + 1,
                    "examples": len(batch),
                    "loss": loss,
                    "seconds": round(time.monotonic() - started, 2),
                    "grad_norm": optim.metrics.get("grad_norm"),
                }
                metrics["steps"].append(record)
                print(json.dumps(record), flush=True)
            name = f"lantern-guide-{run_id}"
            training = model.save_weights(name + "-train", mode="training", ttl=timedelta(days=30))
            inference = model.save_weights(name + "-inf", mode="inference")
        metrics["checkpoint"] = {"training": training.path, "inference": inference.path}
        (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
        latest = {"run_id": run_id, "base_model": model_name, "checkpoint": inference.path}
        (RUNS / "latest.json").write_text(json.dumps(latest, indent=2) + "\n")
        print(f"saved {inference.path} to {run_dir / 'metrics.json'}", flush=True)
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
