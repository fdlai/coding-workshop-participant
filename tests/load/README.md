# API load testing (Artillery)

Load and performance tests for the FastAPI backend (`backend/acme-api`), covering the
"Performance Testing" requirements in `docs/full-stack.md`:

1. **Load testing**: API endpoints under concurrent load with [Artillery](https://www.artillery.io/).
2. **Performance monitoring**: response-time percentiles, throughput and error rate from
   Artillery, plus backend CPU and memory sampled once per second.

## Quick start

From the repository root (Git Bash on Windows, or any shell on Linux/macOS):

```sh
./bin/test-load.sh
```

The script:

1. Recreates the disposable PostgreSQL database `acme_e2e`, runs the Alembic migrations
   and seeds the demo data. The development database (`POSTGRES_NAME` in
   `backend/acme-api/.env`) is never touched.
2. Starts the backend (`uvicorn main:app`, one worker) on port 8000 against `acme_e2e`.
   If port 8000 is already in use it stops with an error instead of testing the wrong
   server. Use `BACKEND_PORT=8002 ./bin/test-load.sh` to run next to a dev server.
3. Samples the backend process CPU and memory every second
   (`monitor-process.ps1` on Windows, `/proc` or `ps` on Linux/macOS).
4. Runs `npx artillery@2.0.34 run tests/load/api-load.yml`. Artillery is not installed
   globally or added to any package.json.
5. Writes to `tests/load/reports/` (git-ignored):
   - `report-<timestamp>.json`: the full Artillery report (`--output`)
   - `resources-<timestamp>.csv`: backend CPU (% of one core) and memory (MB) per second
   - `summary-<timestamp>.md`: p50/p95/p99, throughput, error rate, peak concurrency,
     per-endpoint latencies and CPU/memory, produced by `summarize.mjs`
6. Stops the backend and exits non-zero if any `ensure` threshold failed.

To run against an API that is already running (for example with a different dataset):

```sh
LOAD_TEST_PASSWORD='<seeded demo password>' \
  npx artillery@2.0.34 run --target http://127.0.0.1:8000 \
  --output tests/load/reports/report.json tests/load/api-load.yml
node tests/load/summarize.mjs tests/load/reports/report.json
```

## Scenario (`api-load.yml`)

| Phase | Duration | New virtual users/s |
| --- | --- | --- |
| warm-up | 20 s | 1 |
| ramp-up | 40 s | 1 → 4 |
| sustained-high-concurrency | 90 s | 4 (about 40 users active at once) |

Each virtual user (VU) picks a row from `users.csv` (seeded demo accounts) and runs one
of these flows, weighted towards managers:

| Flow | Weight | Requests |
| --- | --- | --- |
| Health check | 1 | `GET /health` × 10 |
| Admin browsing | 2 | login once, then 8 × (`/dashboard/admin`, `/projects`, `/projects/{id}/budget`, `/users`) |
| Manager browsing | 4 | login once, then 8 × (`/dashboard/manager`, `/projects`, `/projects/{id}/budget`) |
| Employee browsing | 3 | login once, then 8 × (`/dashboard/employee`, `/projects`) |

Each loop iteration ends with 1 s of think time. Login uses PBKDF2 with 600,000
iterations (about 100 ms of CPU, deliberately slow), so each VU signs in **once** and
reuses its token, as a browser session would.

## Pass/fail thresholds

| Check | Limit |
| --- | --- |
| Overall p95 / p99 | < 300 ms / < 500 ms |
| `POST /auth/login` p95 | < 600 ms |
| `GET /dashboard/manager` p95 | < 400 ms |
| `GET /projects` p95 | < 250 ms |
| `GET /projects/{id}/budget` p95 | < 300 ms |
| Successful (200) responses | > 99% of requests |
| Failed virtual users | 0 |

These limits come from local runs (see below), with about 1.5× headroom for machine
noise. A 2× slowdown or any burst of errors fails the run.

## Results (local, 2026-10-15)

Windows 11 laptop with 16 logical cores, PostgreSQL 18 on the same machine, one uvicorn
worker, seeded demo data (about 100 users and 40 projects).

| Run | Requests | Mean / peak req/s | p50 | p95 | p99 | Max | Errors | Backend CPU avg / max | Memory start → max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 VU/s (run 1) | 10,735 | 67.7 / 97 | 19 ms | 156 ms | 252 ms | 467 ms | 0 | 92% / 202% | 88 → 109 MB |
| 4 VU/s (run 2) | 10,738 | 67.6 / 96 | 23 ms | 191 ms | 290 ms | 453 ms | 0 | 97% / 206% | 88 → 109 MB |
| 4 VU/s (final, `bin/test-load.sh`) | 10,819 | 67.8 / 99 | 16 ms | 128 ms | 198 ms | 426 ms | 0 | 85% / 186% | 88 → 108 MB |

The slowest endpoints are `POST /auth/login` (p95 about 300 ms, by design) and the
dashboards (p95 200 to 270 ms). The project list and budget endpoints stay under
150 ms at p95.

CPU is quoted as a percentage of **one** core. The backend averages about one full core:
request handling is bound by Python's GIL, and only the PBKDF2 hashing during login runs
on other cores in parallel. Memory grows from about 88 MB to about 109 MB and levels off,
with no sign of a leak.

### Capacity findings

The single-worker dev server was also tested above the configured load:

- **3 VU/s:** about 53 req/s, p95 107 ms, no errors.
- **5 VU/s:** about 84 req/s and no errors, but latency triples (p95 268 ms, p99 369 ms)
  with CPU averaging 124% of a core. This is close to saturation.
- **6 VU/s:** past capacity. Requests arrive faster than one process can serve them, the
  queue grows, and 2-9% of requests hit the 10 s client timeout (backend CPU 110-260% of
  a core). The server needs a few minutes to drain the backlog after the load stops.
  An early run logged `QueuePool limit of size 5 overflow 10 reached`, so a larger
  connection pool was tried (`pool_size=10, max_overflow=30`, one connection per AnyIO
  worker thread). It made things **worse** (timeouts 177 → 298, p95 478 → 907 ms): more
  requests ran at once and competed for the same CPU. The pool change was reverted; the
  limit is CPU in a single Python process (GIL, plus deliberately slow PBKDF2 logins),
  not a connection leak or deadlock.

  To serve more load from one host, run several uvicorn workers (`--workers N`). The
  deployed Lambda runs one request per container and scales out per request, so this
  ceiling applies to local or single-container hosting, not the AWS deployment.
