# LabGrownBox Deployment Playbook

This guide is the exact sequence to take this app from your local machine to a usable production setup.

## 0) What is already done

- Prisma migration status checked: schema is up to date.
- `npx prisma migrate deploy` run successfully (no pending migrations).
- Build verification passed (`npm run build`).

## 1) Accounts you need (one-time)

1. GitHub account (code hosting)
2. Vercel account (app hosting)
3. Database account: Neon or Supabase (Postgres)
4. Google AI Studio account (Gemini API key)
5. Optional: Google account for Apps Script (if you want Google Sheets sync)

## 2) Prepare repo for GitHub

From project root:

```bash
git status
git add .
git commit -m "prepare production-ready deployment"
git remote add origin <your-github-repo-url>   # only if not set
git push -u origin main
```

## 3) Create production database

Use Neon or Supabase and create a Postgres database.

Copy the Postgres connection string as `DATABASE_URL`.

Example format:

```text
postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

## 4) Connect project to Vercel

1. Open Vercel dashboard
2. New Project -> Import your GitHub repo
3. Framework preset: Next.js
4. Add environment variables:
   - `DATABASE_URL` = your Postgres URL
   - `GEMINI_API_KEY` = Gemini key (recommended server-side)
   - Optional: `GEMINI_MODEL` (default currently works)

## 5) Run database migrations in production

Run this once against production DB:

```bash
DATABASE_URL="<your-prod-postgres-url>" npx prisma migrate deploy
```

If you use Vercel build hooks/CI, ensure migrations happen before serving traffic.

## 6) First production validation checklist

After Vercel deploy URL is live:

1. Open `/` and verify orders UI loads
2. Open `/settings`
3. Paste Gemini key in "Gemini API key (testing)" and click **Test key**
4. Scan one invoice and verify extraction fills key fields
5. Create one order, edit it, delete it
6. Verify dashboard and statements pages open

## 7) Optional Google Sheets sync setup

If you want Sheets syncing from the orders app settings flow:

1. Create Apps Script Web App endpoint
2. Set script URL and shared secret in app settings
3. Test with one order save and confirm row appears in sheet

## 8) Storage reality check (important)

Current app uses local/server filesystem for some assets (`uploads/`).

- Local dev: works
- Serverless production: not durable long-term

For robust production, migrate uploads to cloud object storage (Supabase Storage / S3 / Vercel Blob).

## 9) Everyday update workflow

```bash
git add .
git commit -m "your change"
git push
```

Vercel auto-redeploys from GitHub.

## 10) Fast troubleshooting

- Build fails on Vercel: check Environment Variables are set exactly
- DB errors: verify `DATABASE_URL` and run `prisma migrate deploy`
- Gemini not extracting: test key in Settings and inspect `/api/extraction/preview`
- Stale UI: hard refresh (service worker cache)

## 11) Quick launch command summary

Local run:

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Production lifecycle:

1. Push to GitHub
2. Vercel deploy
3. Set env vars
4. Run production migration
5. Validate with checklist

---

If you want, next step is a dedicated "Production hardening" pass (cloud uploads, backup strategy, role-based auth).
