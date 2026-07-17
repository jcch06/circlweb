# Async Oracle pipeline (option B) — WIP

Resumable, background-friendly network analysis so a large network (up to ~10k
contacts) can be analyzed in bounded chunks instead of one synchronous
browser-driven run that blows past every 60s serverless limit.

**Status: first cut — needs live testing against Supabase + Mistral.** The
synchronous pipeline on `main` is untouched and remains the default; this is an
additive, opt-in path ("Gros réseau" button).

## How it works

State lives in two tables (`supabase/migrations/20260720090000_add_analysis_jobs.sql`):

- `analysis_jobs` — one row per run: `status`, `phase`, progress counters,
  carried context (userProfile, bridge/locked), and the final `synthesis` /
  `supply_demand`.
- `analysis_job_batches` — one row per MAP batch, written when that batch's
  result is computed (small independent writes, no giant blob rewrite).

The orchestrator `api/oracle/job.ts` is a state machine. Each `advance` call
does ONE bounded slice and persists it, so no single invocation risks a 504:

1. **embed** — warm the embedding cache in waves of `EMBED_WAVE` (250) contacts
   by calling `topology` in `embedOnly` mode. Repeats until nothing is left to
   embed. (This is why fresh 10k embedding no longer 504s.)
2. **plan** — call `topology` normally (embeddings now warm → fast); persist the
   batch definitions. Batches with an inline cached MAP result start `done`.
3. **map** — run `MAP_WAVE` (6) pending batches per advance via `map-batch`;
   store each result and mark it done.
4. **reduce** — hierarchical. A network with <= `SINGLE_REDUCE_MAX` (25)
   batches does one reduce. Larger: reduce batches in groups of `REDUCE_GROUP`
   (20) into partial syntheses, `REDUCE_WAVE` (2) groups per advance, then a
   final **merge** pass (reduce endpoint's `partialSyntheses` mode) consolidates
   the partials into one synthesis. Every batch reaches the synthesis — not just
   a richest subset.
5. **supply** — build the offre/demande matrix via `supply-demand`.

It REUSES the existing endpoints (topology/map-batch/reduce/supply-demand) over
internal HTTP, forwarding the caller's JWT — no logic duplicated except the
topology `embedOnly`/`maxAnalyze` modes it added.

The client (`src/lib/oracleJob.ts`) creates a job then loops `advance` until
done, reporting progress. Because all state is in Supabase, the loop is
**resumable**: close the tab, reopen, call `runAnalysisJob(jobId)` to continue.

## Autonomous background (cron)

`api/cron/advance-jobs.ts` runs every minute (see `vercel.json` `crons`). It
finds RUNNING jobs whose `heartbeat_at` is stale (client tab closed → no advance
for 90s) and pushes each forward a couple of slices — so a job finishes even
with no tab open. An actively-driven job keeps a fresh heartbeat and is skipped,
so the client and cron don't fight.

Auth: the cron has no user session. It uses the **service-role key** only to
LIST stale jobs, then mints a short-lived JWT (signed with `SUPABASE_JWT_SECRET`,
marked `oracle_cron`) for each job's OWNER and calls the normal job endpoint with
it. Every endpoint accepts that token via a local signature check that triggers
ONLY for the `oracle_cron` claim — normal user tokens keep going through Supabase
`getUser` unchanged. So all downstream contact reads run under the owner's RLS;
no service-role data access, no cross-user scoping to get wrong.

## Before it works, you must

1. **Apply the migration** (`20260720090000_add_analysis_jobs.sql`).
2. **Set env vars** in Vercel:
   - `SUPABASE_JWT_SECRET` — the project's JWT secret (Supabase → Settings →
     API → JWT Secret). Needed to mint + verify the cron's owner tokens.
   - `SUPABASE_SERVICE_ROLE_KEY` — to let the cron list stale jobs across users.
   - `CRON_SECRET` — Vercel injects this as the cron request's bearer; the
     endpoint rejects anything else.
   Without these, the sync path and the client-driven async path still work;
   only the autonomous cron is disabled.
3. Test on a real large network and watch the phases advance.

## Known limitations / next steps

- **Client/cron race.** If a client returns mid-cron-drive, both could advance
  the same job within the 90s window. MAP double-work is idempotent (results
  upsert); the grouped-reduce partial append is the one spot that could
  duplicate — a short advisory lock (e.g. a `claimed_by`/`claimed_at` on the
  job) would close it. Low-probability, documented.
- **Client memory.** `App.tsx` still loads all contacts client-side (paginated)
  with a 15s timeout — fine for the pipeline (which is server-side) but the rest
  of the app holding 10k contacts in memory is a separate concern.
- The `map` phase runs its wave's batches sequentially inside one advance; if a
  wave itself approaches 60s under heavy rate-limiting, lower `MAP_WAVE`.
