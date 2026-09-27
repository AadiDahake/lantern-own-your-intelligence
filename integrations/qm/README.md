# Lantern in QM: the gap room

This directory is a QM deployment for the `docker` target, made with `qm init`, plus the Lantern
pack. Lantern finds the requests that the product cannot do and groups them into gaps. The pack
puts each gap into a QM room, where teammates and the room agent work it together.

| Part | Path | What it does |
|---|---|---|
| Deployment | `qm.config.jsonc`, `package.json`, `.env.example` | QM core and the web UI in Docker, with agent computers as local containers and OpenAI as the model provider |
| Skill | `sandbox/skills/lantern-gap-room/SKILL.md` | Teaches the room agent to work a gap from Lantern's evidence only |
| Tool | `sandbox/tools/lantern/` | `lantern gaps` reads `GET /api/requests` from Lantern and prints each gap with its evidence |
| Room bridge | `scripts/gap-room.mjs` | Lantern as the QM surface `lantern`: makes the room, posts the gap as a thread, prints the agent's reply |

The room is one QM project named "Lantern gaps". Each gap is one thread in it
(`lantern:gap:<group id>`), so each member of the project reads and continues the same thread.

## Demo

Run every command from this directory. The QM CLI needs Node 24 or newer.

```bash
npm install                     # the pinned QM CLI
cp .env.example .env            # or keep the .env that `qm init` made
npm exec qm -- check            # config, skill and tool are valid
```

Fill `OPENAI_API_KEY` in `.env` and set `PUBLIC_API_URL=http://localhost:8080`.

```bash
npm exec qm -- up               # core on :8080, web UI on :8082
npm run gap-room -- --from fixtures/requests.json
```

The last command prints the gap, the room, the thread, and the room agent's answer. To post the
live gaps instead of the saved copy, run the Lantern dashboard and give the bridge its console
token:

```bash
LANTERN_URL=http://localhost:3000 LANTERN_CONSOLE_TOKEN=... npm run gap-room
```

`--dry-run` prints the signed turn without sending it. `--id <group id>` picks one gap.

## Configuration

| Variable | Where | Default |
|---|---|---|
| `CORE_SIGNING_SECRET` | `.env`, made by `qm init` | none; the bridge signs every core request with it |
| `PORTAL_IDENTITY_SECRET` | `.env`, made by `qm init` | none; the bridge signs the room owner's identity with it |
| `QM_CORE_URL` | environment or `.env` | `http://localhost:8080` |
| `QM_PRINCIPAL` | environment or `.env` | `admin@lantern.local`; the owner of the room |
| `LANTERN_URL` | environment | `http://host.docker.internal:3000` |
| `LANTERN_CONSOLE_TOKEN` | environment | none; the same token `npm run tail` uses |

`npm test` checks the request signature and the thread shape. `npm exec qm -- down` stops QM.
