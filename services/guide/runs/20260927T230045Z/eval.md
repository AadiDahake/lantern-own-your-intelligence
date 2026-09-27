# Lantern guide model, run 20260927T230045Z

Base model `Qwen/Qwen3.6-35B-A3B-FP8`, LoRA rank 16, 11 train steps on 329 decisions from 50 high reward walks.

Unseen tasks: 108 decisions from 15 held-out sessions. Temperature 0.

| Metric | Base model | Trained guide |
|---|---|---|
| Next control correct | 39.8% | 76.8% |
| Invalid answer | 1.8% | 0.0% |
| Correct, confirm step | 73.3% | 100.0% |
| Correct, passenger step | 58.5% | 100.0% |
| Correct, seat step | 15.4% | 51.9% |
| Mean seconds per decision | 2.573 | 3.124 |

Training loss by step: 0.6472, 0.0839, 0.0686, 0.1461, 0.0414, 0.0413, 0.0483, 0.0469, 0.0085, 0.0255, 0.0032
