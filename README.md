# Travelgenix Logo Library

Internal tool for discovering, processing and storing brand logos for use on Travelgenix client sites.

## What it does

1. Take a brand name (e.g. "Virgin Atlantic")
2. Resolve it to a domain (virginatlantic.com)
3. Fetch logos from Brandfetch, Clearbit, Logo.dev in parallel
4. Pick the best result (or let user choose)
5. Generate transparent PNG and SVG variants
6. Save to Vercel Blob storage and write a record to Airtable

## Architecture

- **Frontend:** Static HTML/CSS/JS in `/public`, password-gated
- **Backend:** Vercel API routes in `/api`
- **Storage:** Vercel Blob (logo files), Airtable (metadata)
- **Auth:** Shared password for admin UI; public read API for the future Logo Showcase widget

## Local development

```bash
npm install
cp .env.example .env
# fill in .env with real values
npm run dev
```

Open http://localhost:3000

## Deployment

```bash
npm run deploy
```

Set environment variables in the Vercel dashboard. The custom domain `logos.travelgenix.io` is configured via Vercel project settings.

## Public read API

`GET /api/list?domain=virginatlantic.com` returns the asset list for a brand. Used by the future Logo Showcase widget in tg-widgets. No auth required, rate limited to 60 req/min per IP.

## Airtable schema

Base: `appWOGt1R6SaoSaVy`

- **Brands** (`tblcy7DwlCfCdUNVd`) — one record per brand
- **Assets** (`tblMmJWiimFI9xwln`) — one record per file variant
- **Discovery Log** (`tblX9OX83mXK1arps`) — audit trail of every search
