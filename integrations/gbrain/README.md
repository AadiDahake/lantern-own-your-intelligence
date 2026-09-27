# The company brain on GBrain

Lantern keeps what it knows about one customer company in a GBrain workspace: one page for each
help article and one page for each known gap. The documentation check asks the brain first and
falls back to the present search.

## Configure

| Variable | Value |
|---|---|
| `GBRAIN_MCP_URL` | The MCP address of the GBrain workspace |
| `GBRAIN_TOKEN` | A token of that workspace with write permission for the sync, read permission for the search |

The token can be the bare token, `Bearer <token>`, or the whole header line
`Authorization: Bearer <token>`. The names `gbrain_mcp_url_hackathon` and `gbrain_token_hackathon`
are read too. With one of the two values not set, the brain is off: `searchBrain` answers
`not configured`, nothing is called, and the documentation check works as before.

## Run

```bash
npx tsx integrations/gbrain/sync.ts
npx tsx integrations/gbrain/search.ts "Where do I add a checked bag?" help/
npx tsx integrations/gbrain/search.ts "Can you find us three seats together?"
```

`sync.ts` lists the tools of the server, then calls `put_page` one time for each page. A write
replaces the page with the same slug, so a second run changes nothing. `search.ts` calls the same
`searchBrain` that the documentation check calls.

## Files

| File | What it holds |
|---|---|
| `sync.ts` | The sync command |
| `search.ts` | The search command |
| `pages.ts` | An article or a gap in, a slug and Markdown with frontmatter out. Pure. |
| `data/help-articles.json` | The help articles of NovaAir, from `lib/help/articles.ts` of the NovaAir repository |
| `data/known-gaps.json` | The gaps that the test fixtures and the answer key of `scripts/eval-docs.ts` name |
| `apps/web/lib/brain/config.ts` | The two variables |
| `apps/web/lib/brain/mcp.ts` | The MCP client: one POST for each call, no session |
| `apps/web/lib/brain/provider.ts` | `searchBrain(query, options)` |

## Rules

- The slug prefix says what kind of page it is: `help/` or `gaps/`. A check reads only its own
  prefix. A gap page names the feature more plainly than any article, so the documentation check
  never reads one.
- The brain can find a capability. It cannot rule one out. A brain that is off, late (1,500 ms),
  or empty gives the question to the present search.
- A passage that the brain matched on meaning alone (`weak_semantic`) is read by the model before
  it counts.
- What the brain returns is input from outside the system. `provider.ts` checks each field and
  casts nothing.
