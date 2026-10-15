# Testing Guide

How the ACME application is tested, how to run every suite on the workshop VDI,
the latest results, and the known gaps. Each section maps to the "Testing" criteria
and "Testing Expectations" in [full-stack.md](./full-stack.md).

## Requirements Coverage

| `full-stack.md` requirement | How it is met | Result |
|---|---|---|
| Backend unit tests: Lambda functions in isolation | `tests/test_function_handler.py` drives `function.handler` with Function URL and maintenance events; service tests call business logic directly | Passing |
| Backend integration tests: API endpoints with actual database connections | The whole pytest suite runs against PostgreSQL with `--postgres`, plus `tests/test_postgres_integration.py` (Alembic migrations, constraints, timestamps, `Decimal` precision) | 400 passed on PostgreSQL |
| Backend error handling tests for CRUD | `tests/test_api_error_paths.py` and per-feature tests: 401, 403, 404, 409, 422 and database-constraint races | Passing |
| Frontend component tests (Jest + React Testing Library) | `frontend/src/**/__tests__/*.test.jsx` | 331 passed |
| Frontend API integration tests with mocked responses | `src/services/__tests__/api.test.js` and `endpoints.test.js` (every endpoint function), plus page tests that fake the backend at `fetch` level | Passing |
| End-to-end tests (Cypress) | `frontend/cypress/e2e/01`–`09`: real UI → FastAPI → PostgreSQL | 35 passed |
| Load testing (Artillery) | `tests/load/api-load.yml` with pass/fail thresholds | All 8 thresholds met, 0 errors |
| Performance monitoring | `bin/test-load.sh` samples backend CPU and memory every second and writes latency percentiles per endpoint | See [Performance](#performance-artillery) |
| Coverage: backend ≥ 80% | pytest-cov, enforced with `fail_under = 80` | **96.7%** |
| Coverage: frontend ≥ 80% | Jest, enforced with `coverageThreshold` 80% on every metric | **99.8%** statements, **97.6%** branches |
| Coverage: API endpoints ≥ 90% (CRUD) | `routers/` coverage | **100%** (all 9 router files) |
| Coverage: error handling ≥ 90% | Error paths in routers and services | Routers 100%; services 97.6% |
| Coverage: critical user paths 100% E2E | Every path in [Critical User Paths](#critical-user-paths-e2e) has a Cypress spec | 100% of the listed paths |
| Manual validation through persistence | [Manual Validation](#manual-validation) checklist | Steps below |
| Test artifacts documented (commands, results, gaps) | This document | — |

## Quick Start (VDI)

The runners set themselves up on a fresh clone. On first run they create
`backend/acme-api/.venv`, install `requirements.txt` + `requirements-dev.txt`, copy
`backend/acme-api/.env.sample` to `.env` (VDI defaults: `postgres` / `postgres123` on
`localhost:5432`), and run `npm ci` when `node_modules` is missing.

```sh
# Backend: unit + API tests with coverage (in-memory SQLite, no services needed)
./bin/test-backend.sh

# Backend: the same suite + PostgreSQL integration tests (database acme_test)
./bin/test-backend.sh --postgres

# Frontend: lint, Jest component/API tests with coverage, production build
cd frontend && npm ci && npm run lint && npm run test:coverage && npm run build && cd ..

# End-to-end: resets acme_e2e, starts backend :8000 + Vite :5173, runs Cypress
./bin/test-e2e.sh

# Load test: resets acme_e2e, starts the backend, runs Artillery, records CPU/memory
./bin/test-load.sh
```

Prerequisites, all installed by `./bin/setup-environment.sh`: Python 3.13, Node.js 22,
and PostgreSQL running on `localhost:5432`.

- **Ports:** `test-e2e.sh` and `test-load.sh` need ports 8000 and 5173 free. Stop
  `start-dev.sh` first, or set `BACKEND_PORT` and `FRONTEND_PORT`.
- **Cypress on Ubuntu:** if Cypress reports missing libraries, install them with
  `sudo apt install -y libgtk2.0-0 libgtk-3-0 libgbm-dev libnotify-dev libnss3 libxss1 libasound2 libxtst6 xauth xvfb`.
- **Database safety:** tests only use `acme_test` and `acme_e2e`. Guards refuse any other
  name, so the application database `acme_db` is never read or changed.

## Backend (pytest)

Location: `backend/acme-api/tests/`. The config is in `backend/acme-api/pyproject.toml`.

| Area | Main files |
|---|---|
| Auth, roles, permissions | `test_auth.py`, `test_users.py`, `test_api_error_paths.py` |
| Scheduling and assignments | `test_assignments.py`, `test_relationships.py`, `test_concurrency.py` |
| Milestones | `test_milestones.py` |
| Costs and budget (fixed clock, exact `Decimal`) | `test_cost_service.py`, `test_budget.py`, `test_work_terms.py` |
| Dashboard and audit log | `test_dashboard_audit.py` |
| Lambda handler and maintenance actions | `test_function_handler.py`, `test_maintenance.py` |
| Seeding, password hashing, JWT secret | `test_seed.py`, `test_password_hashing.py`, `test_jwt_secret.py` |
| PostgreSQL only | `test_postgres_integration.py`, `test_db_guard.py` |

Every case listed in `specifications.md` section 16 has a test. Tests freeze "today" at
2030-06-12, so results don't depend on the date they run.

**Latest results (2026-10-15)**

| Run | Tests | Coverage |
|---|---|---|
| `./bin/test-backend.sh` (SQLite) | 378 passed, 22 skipped | 96.7% |
| `./bin/test-backend.sh --postgres` | 400 passed | 96.7% |
| Clean Ubuntu 22.04 checkout, Python 3.13 (SQLite) | 378 passed, 22 skipped | 96.7% |

- **Skipped tests:** the 22 skips in the SQLite run are the PostgreSQL-only tests; they all
  run with `--postgres`.
- **Coverage by package:**

  | Package | Coverage |
  |---|---|
  | `routers/` | 100% |
  | `models/` | 100% |
  | Top-level modules (incl. `function.py`) | 100% |
  | `schemas/` | 98.9% |
  | `services/` | 97.6% |
  | `scripts/` | 92.7% |

- **Running part of the suite:** the 80% gate applies to the whole suite. Add `--no-cov`
  when running a subset, e.g. `./bin/test-backend.sh --no-cov -k budget`.

## Frontend (Jest + React Testing Library)

- **Location:** `frontend/src/**/__tests__/`. Shared helpers are in `frontend/src/test/`.
- **Config:** `frontend/jest.config.cjs` and `frontend/babel.config.cjs`.
- **How the backend is faked:** `mockApi()` replaces `fetch` with a table of routes. Each
  test therefore runs the real `api.js` and `endpoints.js`: URLs, auth headers, JSON
  parsing and `ApiError` handling. Any call a test didn't expect fails that test.
- **What's covered:** every page and component. Each page has a loaded state, an empty
  state, an error state (including a 403 "Access denied" and a retry) and role
  differences:
  - Employees see no edit controls and no budget data.
  - A manager who doesn't own a project gets a read-only view.
- **Required journeys:** these from `specifications.md` section 16 each have explicit tests:
  - Login and logout
  - Role-aware navigation
  - Project list and detail
  - Admin user creation
  - Milestone creation
  - Employee assignment (including the 409 overlap error)
  - Budget display (on track, at risk, over budget)
  - Error handling

**Latest results (2026-10-15)**, identical on Windows and on a clean Ubuntu 22.04 checkout:

```
Test Suites: 31 passed, 31 total
Tests:       331 passed, 331 total
Statements   : 99.78%    Branches : 97.61%    Functions : 99.56%    Lines : 99.74%
```

## Critical User Paths (E2E)

Cypress drives the real UI against the real backend and a freshly seeded `acme_e2e`
database. Each spec creates its own uniquely named data, so specs are independent and
can be re-run. Retries are off.

| Spec | Critical paths covered |
|---|---|
| `01-auth.cy.js` | Each role signs in and out, wrong password, session survives reload, invalid token logs out |
| `02-role-navigation.cy.js` | Each role sees only its own navigation; out-of-role pages show "Access denied"; admin APIs return 403/401 |
| `03-admin-users.cy.js` | Admin creates a manager and an employee, links them, duplicate username rejected, deactivated user can't sign in |
| `04-projects-milestones.cy.js` | Admin creates a project; manager adds milestones; overlapping, out-of-range and invalid dates rejected |
| `05-compensation-budget.cy.js` | Future-dated raise; budget matches a day-by-day calculation; history preserved through raise, removal and deactivation |
| `06-assignments.cy.js` | Manager assigns an employee; double-booking blocked in the UI and by the API; adjacent dates allowed; transfer and remove keep history |
| `07-employee-experience.cy.js` | Employee dashboard and schedule; no edit controls; Budget access denied; mutations return 403 |
| `08-audit-archive.cy.js` | Archive and restore (project becomes read-only); audit log filters; recent activity on dashboard |
| `09-error-handling.cy.js` | Network failure with retry, server 500, 403/404 pages, 401 mid-session logs out (stubbed with `cy.intercept`) |

**Latest result (2026-10-15):** `./bin/test-e2e.sh`: 35 passed, 0 failed, 9 of 9 specs
(about 1.5 minutes).

Run one spec: `./bin/test-e2e.sh --spec cypress/e2e/01-auth.cy.js`. Interactive mode
against a running stack: `cd frontend && npm run e2e:open`.

## Performance (Artillery)

- **Scenario:** `tests/load/api-load.yml`, run with `./bin/test-load.sh`.
  - Phases: 20 s warm-up, 40 s ramp to 4 new virtual users/s, then 90 s sustained.
  - Each virtual user signs in once, then loops over the dashboard, project list, budget
    and user list with think time.
- **Thresholds:** the run fails if any threshold is missed: overall p95 and p99, p95 per
  key endpoint, at least 99% HTTP 200, and no failed virtual users.
- **Output:** the report, CPU/memory samples and a Markdown summary go to
  `tests/load/reports/` (git-ignored).
- **Details:** scenario and capacity notes are in [tests/load/README.md](../tests/load/README.md).

**Latest result (2026-10-15)**, single local uvicorn process:

| Requests | Mean throughput | p50 | p95 | p99 | Max | Errors | Backend CPU (avg / max) | Memory |
|---|---|---|---|---|---|---|---|---|
| 11,049 | 69.2 req/s | 21 ms | 156 ms | 238 ms | 571 ms | 0 | 96% / 205% of a core | 88 → 108 MB peak, 106 MB at end (no leak) |

**Capacity:** above about 5 new users/s, one local process runs out of CPU and requests
start timing out. A larger database connection pool was tried and made this worse, so it
was reverted. The limit is CPU, not a bug. The AWS deployment runs on Lambda, which
scales out per request.

## Manual Validation

These checks confirm the flow from the UI through to PostgreSQL. Start the stack with
`./bin/start-dev.sh`, or run uvicorn and `npm run dev`. Seed demo data with
`python scripts/seed.py` (it needs `SEED_DEMO_PASSWORD`), then:

1. Sign in as an admin and create a user. In `psql acme_db`, confirm the row:
   `SELECT username, role FROM users ORDER BY id DESC LIMIT 1;`.
2. As the admin, create a project and a milestone, then refresh the page. Both still show,
   so they were saved.
3. Sign in as that project's manager and assign an employee. Try to assign the same
   employee to an overlapping milestone on another project; the overlap error appears.
4. Add a future-dated pay rate for the employee. The project's Budget tab updates its
   projected cost, and `employee_work_terms` has the new row.
5. Sign in as the employee. The assignment appears on the dashboard and the schedule, and
   there are no edit controls.
6. As the admin, open Audit Logs. Steps 1–4 appear, newest first.

## CI Checks

The repository workflows in `.github/workflows/` pass with these changes:

- **Python:** `bandit -r ./backend` reports 0 issues. `backend/.bandit` excludes `tests/`,
  where `assert` and fixed test credentials are intentional, and `.venv`. One false
  positive is annotated: the OAuth2 `token_type="bearer"`.
- **React:** `npm audit --audit-level=high` reports no high or critical advisories. The
  19 moderate ones are in the Jest toolchain, which is used for tests only.

## Bugs Found by Testing

- **Fixed:**
  - **Audit Logs filters.** When the audit-log request failed, the error replaced the
    filters, so the user couldn't correct a bad date range. The filters now stay visible
    and the page recovers. A regression test covers it.
- **Corrected:**
  - **Out-of-date comments.** Comments in `EmployeesTab.jsx` and `routers/milestones.py`
    said employees see only their own assignments. The intended behaviour, also tested,
    is that employees see their teammates on shared milestones, with no cost data.
- **Tests fixed, not the app:**
  - **Time zones.** Three backend tests mishandled time zones and only failed on
    PostgreSQL. They now convert through `as_utc`, as the app does.

## Known Gaps and Trade-offs

- **Where the E2E and load runners were tested:** they were run on Windows (Git Bash)
  against PostgreSQL 18. On Linux, the backend and frontend suites were run from a clean
  Ubuntu 22.04 checkout. The Linux code paths in the E2E and load runners (process
  management, `/proc` sampling) were reviewed but not executed, because that machine had
  no PostgreSQL or Cypress system libraries.
- **Default database for backend tests:** the default run uses SQLite for speed and needs
  no services. Run PostgreSQL behaviour with `--postgres`; CI doesn't run it because the
  workflows have no database.
- **Where the load test runs:** against a single local process, not the deployed AWS
  Lambda + Aurora stack. AWS numbers would differ, since Lambda scales per request and
  adds cold starts.
- **E2E browser:** Electron, Cypress's default headless browser. Cross-browser runs
  (`--browser chrome` or `firefox`) are possible but not part of the standard run.
- **Error-handling spec uses stubs:** `09-error-handling.cy.js` fakes network failures
  and 500s with `cy.intercept`, since they can't be triggered reliably on a healthy
  stack. Every other spec uses the real backend.
- **Known UI behaviour:** if the session-restore request (`GET /auth/me`) is cut off
  mid-flight, the app treats it as a failed session and signs the user out. In a real
  browser only a page unload interrupts it, so users don't hit this; the E2E helper waits
  for sign-in to finish.
- **Remaining uncovered frontend branches:** a few, mostly defensive fallbacks a user
  can't reach (for example an audit entry without an id). They are listed in the Jest
  coverage report (`frontend/coverage/index.html`).
