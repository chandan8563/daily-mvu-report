# MVU Report - Cloudflare Workers + D1

This version keeps the existing MVU report rules and UI, but adds Cloudflare Workers deployment support and moves Master Data persistence from `data/master.json` to D1 when running on Cloudflare.

## Cloudflare setup

1. Create a D1 database named `daily-mvu-report-db`.
2. Put the returned database ID in `wrangler.jsonc` in place of `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.
3. Apply the migration:
   `npx wrangler d1 migrations apply daily-mvu-report-db --remote`
4. Deploy the Worker.

The GitHub-connected Cloudflare deployment should use:
- Build command: `npm run deploy`
- No separate build output directory is required.

Cloudflare's current Express-on-Workers guide requires `nodejs_compat`, uses `cloudflare:node`/`httpServerHandler`, and supports D1 bindings for persistence.
