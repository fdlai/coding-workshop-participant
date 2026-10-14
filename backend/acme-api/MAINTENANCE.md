# ACME API maintenance operations (AWS Lambda)

Maintenance actions are **direct Lambda invocations** (`aws lambda invoke`), authorized by
your IAM credentials. They are not API routes. Region: `us-east-2`. Function:
`coding-workshop-acme-api-794d5d37`.

| Action | Effect |
|---|---|
| `db_status` | Read-only: database name, schema, PostgreSQL version, tables. |
| `db_migrate` | Runs Alembic to `head` (additive; creates missing tables). |
| `db_seed` | Adds demo data. Idempotent and transactional (all or nothing). |

There is deliberately no `db_reset` yet. See "Reset" below.

## Safeguards

- Events containing HTTP keys (`requestContext`, `version`, `rawPath`, `headers`) go to the web
  app, never to maintenance. This is a filter, not authorization: the Function URL is public
  (`authorization_type = "NONE"`), so only add low-risk, additive actions here.
- The handler refuses to run unless the Lambda is pointed at the expected Aurora host and
  `codingworkshop`.
- `db_seed` requires `confirm_target` to equal exactly `codingworkshop@<aurora host>` and a
  strong `seed_demo_password` (12+ characters with upper-case, lower-case and a digit).
  Unknown payload keys are rejected.
- Seeding is additive: it creates only `demo.*` accounts and records that are missing, never
  updates or deletes existing rows, and runs in one transaction.
- The response contains counts only; it never contains the password or any hash.
- Lambda environment variables are managed by Terraform and are never changed by these steps.

## Run the workflow (PowerShell)

Keep the password out of shell history and source control. It is typed once at a hidden prompt,
written to a temporary payload file, and deleted afterwards.

```powershell
$fn   = "coding-workshop-acme-api-794d5d37"
$host_ = "coding-workshop-rds-794d5d37.cluster-c7wy8oegepqp.us-east-2.rds.amazonaws.com"
$region = "us-east-2"

function Invoke-Acme($payloadJson) {
    $in  = New-TemporaryFile
    $out = New-TemporaryFile
    try {
        [IO.File]::WriteAllText($in, $payloadJson)
        aws lambda invoke --region $region --function-name $fn `
            --cli-binary-format raw-in-base64-out --payload "file://$($in.FullName)" `
            $out.FullName --query "{Status:StatusCode,Error:FunctionError}" --output json
        Get-Content $out.FullName
    } finally { Remove-Item $in, $out -Force -ErrorAction SilentlyContinue }
}

# 1. Check the current tables
Invoke-Acme '{"acme_maintenance_action":"db_status"}'

# 2. Apply or verify migrations (safe to repeat)
Invoke-Acme '{"acme_maintenance_action":"db_migrate"}'

# 3. Seed demo data
$secure = Read-Host "Demo password" -AsSecureString
$plain  = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$payload = @{
    acme_maintenance_action = "db_seed"
    confirm_target          = "codingworkshop@$host_"
    seed_demo_password      = $plain
} | ConvertTo-Json -Compress
Invoke-Acme $payload
$plain = $null; $payload = $null

# 4. Verify: totals appear in the db_seed response; db_status lists the tables
Invoke-Acme '{"acme_maintenance_action":"db_status"}'
```

Then open `https://d3h55c40wd7jid.cloudfront.net` and sign in as `demo.avery.brooks` (admin),
`demo.morgan.hayes` (manager) or `demo.liam.anderson` (employee) with the password you chose.
Running step 3 again creates nothing new (`created` is empty, everything is under `skipped`).

If a response contains `FunctionError`, the printed body is the error message. A password that
fails the strength check, or a wrong `confirm_target`, is rejected before any database write.

## JWT signing secret (one-time setup)

Login needs a signing secret. The app uses `JWT_SECRET_KEY` from the environment if set
(Terraform does not set it); otherwise it reads `jwt_secret.key` from the application directory.
It never generates a secret itself and never accepts the placeholder values. Without a valid
secret, login fails with "No valid JWT secret".

The deployment zip is built from this directory, and Citi's packaging rules exclude only
`__pycache__` and dotfiles (matched against the relative path), so `jwt_secret.key` is
included while `.env` and `.venv` are not. The file is git-ignored.

On WorkSpaces, from `backend/acme-api` (PowerShell shown; use the same commands in bash):

```powershell
python scripts/generate_jwt_secret.py      # creates jwt_secret.key once; refuses to overwrite
git check-ignore -v jwt_secret.key         # must print the .gitignore rule
```

Back the file up somewhere private. Do not regenerate it between deployments: replacing the
secret signs every user out, and a redeploy from a machine without the file removes it from the
package, so keep deploying from the same checkout.

Deploy with Citi's normal script (`bin/deploy-backend.sh`; unchanged). Then verify:

```powershell
# After running db_seed, log in through the CloudFront API path. Prints only the token type.
$body = @{ username = "demo.avery.brooks"; password = (Read-Host "Demo password") } | ConvertTo-Json
(Invoke-RestMethod -Method Post -Uri "https://d3h55c40wd7jid.cloudfront.net/api/acme-api/api/v1/auth/login" `
    -ContentType "application/json" -Body $body).token_type
```

Expected output: `bearer`. If the call returns a 500, check CloudWatch logs for the
"No valid JWT secret" message, which means the file was missing from the deployed package.
(If the login path differs, use the one shown in the browser's network tab.)

## Changing the seed data

Edit `scripts/seed_data.py` (people, reporting lines, `_PROJECT_PLAN`) or `scripts/seed.py` (how
rows are created; add a step to `seed_all()`). Both the local CLI (`python scripts/seed.py`, limited
to localhost `acme_db`) and `db_seed` use `seed_all()`. Seeding never edits existing records, so
changed values for rows that already exist do not apply until those rows are removed. Redeploy the
Lambda, then run `db_seed`.

## Demo accounts

All 100 seeded accounts share **one password**: whatever you pass as `seed_demo_password` (or
`SEED_DEMO_PASSWORD` locally). It is never stored in source. Usernames are `demo.<first>.<last>`
and every account is active. Dates are relative to the day you seed.

| Role | Username | What to show |
| --- | --- | --- |
| Admin (3) | `demo.avery.brooks` | Everything: users, relationships, compensation, audit log, archived projects, all budgets |
| Admin | `demo.nadia.hussain` | Same permissions as above |
| Admin | `demo.theodore.whitfield` | Same permissions as above |
| Manager (12) | `demo.morgan.hayes` | Own projects and team; project/milestone costs only, no individual pay |
| Manager | `demo.priya.natarajan` | Same permissions, different team |
| Manager | `demo.marcus.delgado` | Same permissions, different team |
| Employee (85) | `demo.liam.anderson` | Busy schedule across several projects; own pay and schedule only |
| Employee | `demo.sofia.martinez` | Multi-project workload |
| Employee | `demo.dalia.sandoval` | Available, with no assigned work (empty schedule state) |

Roles: admins manage everything; managers see only projects they own and employees linked to
them, with aggregated costs; employees see their own schedule, profile and non-confidential
project details. Audit rows created by seeding start with `[Synthetic seed data]` and carry
`"synthetic_seed": true`; they are not real user activity.

Expected seeded totals: 100 users, 114 employee-manager links, 135 work terms, 40 projects,
161 milestones, 366 assignments, 219 audit logs (added on top of any real rows).

## Reset (not implemented)

Resetting the database is destructive, and the Function URL is unauthenticated, so it is held
back pending approval. See the proposal in the delivery notes.
