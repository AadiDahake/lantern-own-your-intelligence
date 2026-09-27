# Lantern guide model

A LoRA on a River base model, trained through River's `train_step`. It reads a visitor's goal and
the controls of the page in front of them, and it answers with the next control to light.

## Run it

```bash
# data only: no key, no network
uv run --no-project services/guide/train.py --dry-run
cd services/guide && python3 -m unittest -v

# train, then compare the base model and the trained guide on unseen tasks
RIVER_API_KEY=... uv run --no-project services/guide/train.py
RIVER_API_KEY=... uv run --no-project services/guide/eval.py

# side by side on unseen tasks
RIVER_API_KEY=... uv run --no-project services/guide/choose.py --demo 5
```

## What it learns from

`guide_data.py` reads the PostHog sessions in `packages/capability/test/fixtures/sessions.json`
and grades each one with the compiler's reward rule: `completion` and `coherence`, 1 to 5, and a
`total`. A walk with `total >= 4` is kept. Each press in a kept walk is one example: the goal and
the page controls go in, the control the visitor pressed next comes out. Each example's token
weights are scaled by `0.7 * (completion - 1) / 4 + 0.3 * (coherence - 1) / 4`.

One session in four is held out by a hash of its id. No decision of a held-out walk is in the
training data, so `eval.py` measures the two systems on tasks the guide never saw.

## Output

| File | Contents |
|---|---|
| `runs/<id>/metrics.json` | The data counts, the settings, the loss of each train step, the checkpoints |
| `runs/<id>/eval.json` | Each held-out decision, the answer of each system, and the summary |
| `runs/<id>/eval.md` | The comparison table |
| `runs/latest.json` | The checkpoint that `choose.py` and the web app serve |

The web app asks the guide through `apps/web/lib/guide/provider.ts` (`chooseControl`). River
serves a checkpoint over gRPC only, so the provider runs `choose.py`. With no `RIVER_API_KEY` the
provider is off and the product behaves as before.
