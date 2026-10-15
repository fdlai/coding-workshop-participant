# ACME Project & Resource Management

ACME is a web application for planning projects, scheduling employees onto milestones
without conflicts, and tracking estimated labor cost against each project's budget.
Administrators, managers and employees each get their own view of the same data, with
permissions enforced by the API.

The app was built from a design specification, [specifications.md](../../specifications.md),
written before implementation. Its primary goals:

1. A complete, usable full-stack application.
2. Secure JWT authentication and strict role-based authorization.
3. Project planning through non-overlapping milestones.
4. Employee scheduling, transfers and historical assignment tracking.
5. Accurate labor-cost estimates based on each employee's pay history.
6. Timelines, availability and budget health shown in an attractive interface.
7. Compatibility with the workshop's AWS Lambda, CloudFront and Aurora PostgreSQL
   infrastructure.

- **Frontend:** React 19, Vite, React Router 7 and Tailwind CSS v4 in [`frontend/`](../../frontend/)
- **Backend:** FastAPI, SQLAlchemy 2 and Alembic in this folder
- **Database:** PostgreSQL locally, Aurora PostgreSQL on AWS
- **Deployment:** one AWS Lambda behind CloudFront, using the workshop's Terraform and
  `bin/` scripts

## Contents

- [Roles](#roles)
- [Architecture](#architecture)
- [Business Rules](#business-rules)
- [Run Locally](#run-locally)
- [Deploy to AWS](#deploy-to-aws)
- [Testing](#testing)
- [Trade-offs and Assumptions](#trade-offs-and-assumptions)
- [Further Documentation](#further-documentation)

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything: create and edit users, set managers and pay rates, create and archive projects, view all budgets and the audit log |
| **Manager** | Manage their own projects: milestones, assigning their own team members, budget and cost views, and their team's schedule |
| **Employee** | See their own dashboard, schedule and the projects they work on (including teammates on shared milestones). They can't edit anything or see any pay or cost data |

The frontend hides controls a role can't use, but the API enforces every permission on
every request. A hidden button is never the only protection.

## Architecture

```
Browser ── CloudFront ──┬── /               → S3 (React build)
                        └── /api/acme-api/* → Lambda: function.handler (Mangum → FastAPI) → Aurora PostgreSQL

Local:  Vite :5173  →  uvicorn main:app :8000  →  PostgreSQL :5432 (acme_db)
```

**How it's deployed**

- **API:** the whole API is one FastAPI app. Locally it runs under uvicorn. On AWS it runs
  in a single Lambda through [`function.py`](function.py), where
  `handler = Mangum(app)`, the entry point the Terraform configuration expects.
- **Frontend:** the production build calls the API on the same CloudFront domain, under
  `/api/acme-api`. It uses `HashRouter`, so refreshing a deep link works without
  CloudFront rewrite rules.
- **Database maintenance:** migrating, seeding and status checks on Aurora are direct
  Lambda invocations, not public API routes. See [MAINTENANCE.md](MAINTENANCE.md).

**Backend layout**, organized by domain:

| Folder | Contents |
|---|---|
| `routers/` | Thin HTTP layer, one module per area: auth, users, relationships, projects, milestones, assignments, work terms, audit, dashboard. All under `/api/v1` |
| `services/` | Business logic and authorization: scheduling rules, cost and budget calculation, access checks, audit records |
| `models/`, `schemas/` | SQLAlchemy tables and Pydantic request/response shapes. Responses never include password hashes, and pay data only goes to admins |
| `migrations/` | Alembic migrations |
| `scripts/` | Bootstrap the first admin, seed demo data, generate the JWT secret |

The database diagram is in [docs/er-diagram.md](../../docs/er-diagram.md).

**Frontend layout**, in `frontend/src/`:

| Folder | Contents |
|---|---|
| `services/api.js` | The single HTTP client: JWT header, JSON handling, error messages, sign-out on 401 |
| `services/endpoints.js` | One function per API endpoint |
| `pages/` | Grouped by area: `admin/`, `projects/` and role dashboards |
| `components/ui/` | Shared controls, tables, modals, badges, and loading, empty and error states |

## Business Rules

**Scheduling**

- A manager can only assign employees who report to them. Admins can assign anyone.
- An employee can't be booked on two overlapping assignments, across all projects.
  Back-to-back dates are fine.
- Milestones must fall within the project's dates and must not overlap each other.
- Scheduling changes lock the affected project and employee rows, so two requests at the
  same moment can't double-book someone.
- History is never lost:
  - **Removing someone early:** the assignment gets an end date, and the record stays.
  - **Transferring someone:** the old assignment is ended and a new one is created.
  - **Removing a manager relationship:** that manager's future assignments for the
    employee end.

**Cost and budget**, in [`services/cost_service.py`](services/cost_service.py):

- **Daily cost** = hourly rate × weekly hours ÷ 5, counting weekdays only.
- **Pay rates** are effective-dated. A future raise only applies from its start date, and
  each day uses the rate in force that day.
- **Accrued vs projected:** accrued covers days worked up to yesterday; projected covers
  today onward. A completed milestone stops projecting.
- **Days with no rate on file** are reported as "unpriced", never silently counted as zero.
- **Precision:** money is `Decimal` throughout and rounded to cents once per milestone, so
  the totals add up exactly.
- **Budget health:**
  - *On track:* expected cost is under 95% of the budget.
  - *At risk:* 95% to 100% of the budget.
  - *Over budget:* above the budget.
- **Storage:** costs are always recalculated, never stored, so they can't go stale.

**Audit**

Every administrative change (users, roles, relationships, pay, projects, milestones and
assignments) writes an audit record in the same transaction as the change itself.
Admins can filter the log by action, entity, person and date.

## Run Locally

**Prerequisites:** Python 3.13, Node.js 22 and PostgreSQL. The workshop VDI gets all three
from `bin/setup-environment.sh`.

```sh
# Backend
cd backend/acme-api
python3 -m venv .venv && source .venv/bin/activate      # Windows Git Bash: source .venv/Scripts/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.sample .env                                     # VDI defaults; edit if your PostgreSQL differs
python scripts/generate_jwt_secret.py                   # creates jwt_secret.key (git-ignored)
alembic upgrade head                                    # creates the tables in acme_db
INITIAL_ADMIN_PASSWORD='<choose one>' python scripts/bootstrap_admin.py   # first admin: "admin"
python scripts/seed.py                                  # optional demo data; uses SEED_DEMO_PASSWORD from .env
python -m uvicorn main:app --reload                     # http://localhost:8000/docs

# Frontend (second terminal)
cd frontend
npm ci
npm run dev                                             # http://localhost:5173
```

The demo data creates `demo.*` accounts, for example `demo.avery.brooks` (admin),
`demo.morgan.hayes` (manager) and `demo.liam.anderson` (employee). They all share the
`SEED_DEMO_PASSWORD`. Seeding only adds missing records, so running it again is safe.

## Deploy to AWS

From the repository root on the VDI:

```sh
./bin/deploy-backend.sh aws    # packages backend/acme-api into the Lambda (Terraform)
./bin/deploy-frontend.sh       # builds the frontend, uploads to S3, invalidates CloudFront
```

- **JWT key:** `jwt_secret.key` must exist in this folder before the backend deploy, since
  it's packaged with the code. If it doesn't, create it with
  `python scripts/generate_jwt_secret.py`.
- **Database:** when the tables change, run the `db_migrate` maintenance action after
  deploying. [MAINTENANCE.md](MAINTENANCE.md) also covers `db_status` and `db_seed`.

## Testing

All the commands, latest results and known gaps are in
[docs/testing.md](../../docs/testing.md). In short:

| Suite | Command | Latest |
|---|---|---|
| Backend unit + API (pytest) | `./bin/test-backend.sh` | 386 passed, 96.8% coverage |
| Backend on real PostgreSQL | `./bin/test-backend.sh --postgres` | 408 passed |
| Frontend (Jest + React Testing Library) | `cd frontend && npm run test:coverage` | 341 passed, 99.8% coverage |
| End-to-end (Cypress) | `./bin/test-e2e.sh` | 35 passed |
| Load (Artillery) | `./bin/test-load.sh` | 0 errors, p95 156 ms |

The test runners only use the dedicated test databases `acme_test` and `acme_e2e`.
Guards stop them from ever touching `acme_db`.

## Trade-offs and Assumptions

**Security**

- **Login token in `localStorage`:** the token survives a page refresh, and the
  specification chose a bearer-token approach for simplicity. The downside is that any script running on the page could
  read it if the site had a cross-site scripting (XSS) flaw. The app limits the risk: the
  token is never logged, and the API re-checks permissions on every request. A production
  system would use secure, HTTP-only cookies instead.
- **Token expiry and refresh:**
  - Each token lasts 24 hours. The app renews it through `POST /auth/refresh` 5 minutes
    before it expires, so active users aren't signed out mid-task.
  - Only a still-valid token for an active user can be renewed. Each session also has a
    hard limit of 7 days after sign-in (`MAX_SESSION_DAYS`), so a stolen token can't be
    kept alive forever.
  - When either limit is reached, the API's 401 response signs the user out and they log
    in again.
- **PBKDF2 instead of Argon2 for passwords:** Argon2 needs about 64 MB per hash, which is
  too much for a 128 MB Lambda. PBKDF2-SHA256 with 600,000 iterations follows OWASP's
  guidance. The cost is that each login takes about 100 ms of CPU, which is deliberate.
- **JWT secret in a git-ignored file:** `jwt_secret.key` is packaged with the Lambda, so the
  workshop's Terraform didn't need changing. If a `JWT_SECRET_KEY` environment variable is
  set, it takes precedence.

**Data and calculations**

- **Costs are estimates:** they're based on scheduled time, at hourly rate × weekly hours
  on weekdays. There are no timesheets, and holidays and partial days aren't modelled.
- **Dates are UTC calendar days:** the API and the UI use the same day boundaries, so a
  date never shifts between screens.
- **Projects are archived, not deleted:** an archived project is read-only and can be
  restored. Milestones can only be deleted while nothing is scheduled on them.

**Scale**

- **One local process:** a single uvicorn process handles about 70 requests/s. Above
  roughly 5 new users per second it runs out of CPU (see
  [tests/load/README.md](../../tests/load/README.md)). On AWS, Lambda scales out per
  request, so this ceiling doesn't apply there.

**Files outside the app folders**

While the app was being built, the specification kept changes inside `frontend/` and
`backend/acme-api/` so the workshop's scripts and docs stayed untouched. Later, to meet
the testing requirements in `docs/full-stack.md`, these were deliberately added outside
those folders:

- the `bin/test-*.sh` runners and their helpers
- `docs/testing.md` and the ER diagram in `docs/`
- `tests/load/`
- `backend/.bandit`, which lets the existing Bandit CI check pass

None of them change the workshop's infrastructure or deployment scripts.

## Further Documentation

- [docs/testing.md](../../docs/testing.md): testing guide, results and known gaps
- [docs/er-diagram.md](../../docs/er-diagram.md): database diagram
- [MAINTENANCE.md](MAINTENANCE.md): migrate, seed and status actions on AWS
- [specifications.md](../../specifications.md): the design specification (roles,
  scheduling and cost rules, and the Definition of Done)
