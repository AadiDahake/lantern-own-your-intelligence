# Deploy

Two Vercel projects and one worker process.

| What | Where | Deploys from |
|---|---|---|
| Lantern dashboard, console and API | Vercel project `lantern-codex` | this repository, `main` |
| NovaAir, the demo host app | Vercel project `novaair` | the `novaair` repository, `main` |
| The escalation worker | any machine with `uv`, including a laptop | run by hand, see below |

Both Vercel projects sit in the same personal team and auto-deploy on a push to `main`.

## Vercel project `lantern-codex`

Root directory `apps/web`. Build command `npm run build` at the repository root so the widget is
built and copied into `apps/web/public/widget.js` before Next builds. Node 20 or newer.

Environment variables, all as plain environment variables on the project (Production and Preview):

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | secret |
| `SUPABASE_URL` | |
| `SUPABASE_SERVICE_ROLE_KEY` | secret, server-side only |
| `SUPABASE_ANON_KEY` | not read by the app today, set it for completeness |
| `GITHUB_TOKEN` | secret, fine-grained, contents/issues/pull-requests on the target repository only |
| `VERCEL_TOKEN` | secret, used to watch the target project's deployments |
| `LANTERN_PROJECT_SLUG` | `novaair` |
| `ESCALATION_ENGINE` | `local`. `forge` is refused until the Reflex/Runloop engine exists |
| `NEXT_PUBLIC_APP_URL` | the production origin of this deployment |
| `TARGET_VERCEL_PROJECT` | `novaair` |
| `TARGET_PRODUCTION_URL` | the host product's production address, optional |
| `SLACK_WEBHOOK_URL` | optional |

`DATABASE_URL` is **not** needed on Vercel. It is only used by `npm run db:migrate`, which you run
from your own machine against the same database.

Migrations are not run at build time on purpose, so a failed deploy can never leave the schema half
applied. Run them yourself before deploying a schema change:

```bash
npm run db:migrate
npm run db:seed
```

## Vercel project `novaair`

Root directory is that repository's root, default Next build. It needs only two variables, both
public, and both pointing at the deployed dashboard:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_LANTERN_WIDGET_URL` | `https://<dashboard origin>/widget.js` |
| `NEXT_PUBLIC_LANTERN_KEY` | the seeded project's embed key, printed by `npm run db:seed` |

With either unset the host app renders no widget, which is the correct behaviour for a preview
deployment.

## The worker

The worker is a long-running Python process, not a serverless function, because it holds a run open
and waits for a human approval that may take minutes. It runs anywhere with `uv` installed, a laptop
included.

```bash
cd services/worker
uv sync
uv run python local_runner.py
```

It needs `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN` and
`VERCEL_TOKEN` in its environment. The runner polls the `escalation` table for queued rows with
`engine = 'local'` and executes the steps in order.

Details of the steps are in `services/worker/README.md`.

## Exploring a site

"Explore site" on the console's Product map page queues a job; a serverless function has no
browser. A machine with one carries it: the forge runner (`npm run forge:runner`) picks
up queued explorations beside its own work, or run the queue by hand:

```bash
npm run explore -- --drain                                       # every queued job
npm run explore -- --project novaair --url https://<host site>   # one site, now
```

The console polls the job and shows pages as they are read.

## Checks after a deploy

```bash
curl https://<dashboard origin>/api/health     # {"ok":true,"db":true,"openai":true}
curl -I https://<dashboard origin>/widget.js   # 200, application/javascript
```

Then open the host app and confirm the launcher appears in the corner.
