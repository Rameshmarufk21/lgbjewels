# LabGrownBox — production catalog

Next.js app for orders from **casting → setting**: products, vendor invoices (with metal/karat lines), stone intake, findings, Excel import/export, statements, and a monthly dashboard (including casting metal usage).

## Run locally

```bash
npm install
cp .env.example .env   # set DATABASE_URL (SQLite file or Postgres)
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy & database

See [DEPLOY.md](DEPLOY.md) for Vercel + Postgres (shared team URL).

## PWA

Service worker registers in production builds; install from the deployed HTTPS URL on mobile.
