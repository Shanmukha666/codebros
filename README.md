# CodeBros platform prototype

CodeBros is an online coding studio for students: learn a concept, practice it, get precise feedback, and see progress accumulate.

## Backend quick start

1. Install Node.js 20+ and Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Start PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

4. Install dependencies and initialize the database:

   ```powershell
   npm install
   npm run db:generate
   npx prisma migrate dev --name init
   npm run db:seed
   ```

   The first `migrate dev` creates the PostgreSQL baseline under `prisma/migrations`.
   Commit that folder, and deploy it with `npx prisma migrate deploy`. The SQLite
   demo uses `prisma db push` and never writes to `prisma/migrations`.

5. Start the API:

   ```powershell
   npm run dev
   ```

The API runs at `http://localhost:4000`. Verify it with `GET /api/health`.

## SQLite local demo

No Docker or external database is required for the local demo:

```powershell
npm install
npm run dev:sqlite
```

This prepares `prisma/dev.db`, runs migrations, generates the demo client, seeds five courses, and starts the API on port 4000. It is intended for local judges and development only.

## GitHub Pages frontend

Every push to `main` deploys the static CodeBros screens through
[`.github/workflows/pages.yml`](.github/workflows/pages.yml). In the repository
settings, enable **Pages** with **GitHub Actions** as the source. The frontend
will then be available at:

`https://shanmukha666.github.io/codebros/`

GitHub Pages cannot run the Fastify API or Prisma database. Deploy the backend
through Vercel as described below, then configure the trusted deployed API URL
with `window.CODEBROS_API_URL` before loading `shared/codebros.js`. The frontend
does not accept API URLs from browser storage.

## Vercel deployment

1. Add a PostgreSQL database through a Vercel marketplace integration.
2. Configure `DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `WEB_ORIGIN`, and `NODE_ENV=production` in Vercel project environment variables.
3. Run PostgreSQL migrations with the main `prisma/schema.prisma`.
4. Deploy the repository; `/api/index.ts` serves the Fastify application and `vercel.json` rewrites API routes.

Keep secrets in Vercel environment settings, never in source code or chat. Real code execution is not enabled until an isolated Piston, Judge0, or container runner is configured.

Seeded demo accounts:

- Set `DEMO_STUDENT_PASSWORD` and `DEMO_ADMIN_PASSWORD` before running the seed.
- Student email: `demo@codebros.dev`
- Admin email: `admin@codebros.dev`
- Production seeding is blocked unless `ALLOW_DEMO_SEED=true` is set explicitly.

The password recovery, email verification, 2FA, SSO, connected-account, and recruiter-visibility controls in the static screens are mockups. They do not claim to perform those operations. Profile name and email editing are available through `PATCH /api/me`.

## Implemented API surfaces

- Authentication: register, login, signed access tokens, httpOnly refresh cookie
- Catalog: published courses, search, level filter, pagination, enrollment
- Learning: dashboard summary and lesson completion events
- Assessment: quiz attempts with persisted scores and feedback
- Practice: deterministic challenge runner with persisted run history
- Admin: overview metrics for student, course, enrollment, and run counts
- Admin operations: student directory, course create/update/publish endpoints
- Platform safety: validation, rate limiting, Helmet headers, CORS allowlist, structured errors, role checks

The deterministic runner intentionally does not execute user code inside the API process. It is an adapter boundary for a future isolated worker/container runner.

## Frontend integration

All 16 static screens load `shared/nocturne.css` and `shared/codebros.js`.

- Sign in and create account submit to the real auth routes.
- Course catalog loads the published-course count and can enroll the first published course.
- Student dashboard loads the authenticated dashboard summary.
- Practice IDE sends source to the featured challenge endpoint and displays persisted run feedback.
- Lesson completion actions can persist a lesson when opened with `?lessonId=<id>`.
- Quiz screen discovers a published quiz automatically when no `quizId` is supplied.
- Progress and profile screens load authenticated live summaries; profile name and email edits use `PATCH /api/me`.
- Admin dashboard and student management load live protected data for admin users.
- Admin course builder can create draft or immediately published courses through the protected API.
- Mobile navigation collapses the fixed desktop sidebar into a compact top navigation.
- Navigation links now resolve to the existing screen files instead of `#`.

The static frontend can be served locally with:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/codebros_sign_in/code.html`.

## Cross-site deployment

Refresh cookies are `SameSite=None; Secure` in production so a GitHub Pages frontend
can call a Vercel API, and the API only accepts cookie-authenticated requests whose
`Origin` equals `WEB_ORIGIN`. Browsers that block third-party cookies (Safari, and
Chrome in some modes) will still drop that cookie. For reliable sessions, serve the
frontend and API from the same site, for example `app.example.com` and
`api.example.com`.

## Verification

```powershell
npm run build
npm test
```

The test suite covers the API health contract and deterministic challenge-runner behavior. Before a judged demo, run the database-backed smoke path after PostgreSQL is available:

```powershell
docker compose up -d postgres
npx prisma migrate dev --name init
npm run db:seed
```

## Product and visual direction

The product brief is maintained outside the deployable application source.

The recommended visual system is **Nocturne Citrus**:

- Ink `#132238`
- Paper `#F6F1E8`
- Citrus `#F4A340`
- Mineral `#0C6E69`
- Coral `#D05A3A`
- Lilac `#8A79B8`

It replaces the common indigo SaaS look with a warmer editorial studio identity.
