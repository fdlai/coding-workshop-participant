# ACME Frontend

React frontend for the ACME project and resource management app. Architecture,
business rules, setup and trade-offs are in the main README:
[backend/acme-api/README.md](../backend/acme-api/README.md).

## Stack

- React 19 with Vite 7
- React Router 7, using `HashRouter` so deep links survive a refresh on CloudFront
- Tailwind CSS v4, as required by the project specification
- Jest + React Testing Library for component and API tests; Cypress for end-to-end tests

## Structure

```
frontend/
├── src/
│   ├── App.jsx              # Route table: role-protected routes per role
│   ├── context/             # AuthContext: signed-in user, login/logout, session restore
│   ├── services/            # api.js (single HTTP client), endpoints.js (one function per endpoint)
│   ├── hooks/               # useFetch: loading / error / reload state for API calls
│   ├── components/
│   │   ├── layout/          # Top navigation by role, route guard
│   │   ├── ui/              # Shared controls, tables, modals, badges, feedback states
│   │   └── *.jsx            # Gantt, week calendar, schedule list, project health list
│   ├── pages/               # Dashboards per role, plus admin/ and projects/ feature pages
│   ├── utils/               # Date/money formatting (UTC calendar days), role routes
│   └── test/                # Jest setup and shared test helpers
├── cypress/                 # End-to-end specs and commands
├── jest.config.cjs          # Jest config (80% coverage threshold)
└── vite.config.js
```

## Commands

```sh
npm ci                  # install dependencies
npm run dev             # dev server on http://localhost:5173 (API: http://localhost:8000)
npm run lint            # ESLint
npm test                # Jest component and API tests
npm run test:coverage   # Jest with coverage report (fails below 80%)
npm run build           # production build in dist/
npm run e2e             # Cypress against a running stack; ../bin/test-e2e.sh starts everything
```

- **API address in development:** `VITE_API_URL` overrides `http://localhost:8000`.
- **API address in production:** the build always calls `/api/acme-api` on its own
  CloudFront domain.

## Deploy

```sh
./bin/deploy-frontend.sh    # from the repository root: build, upload to S3, invalidate CloudFront
```

## Testing

See [docs/testing.md](../docs/testing.md) for the commands, latest results and known gaps.
