# mylittlesys

Apps Script `小系統` migration target for GitHub Pages and Cloudflare Workers.

The repository previously contained unrelated static HTML files. The GitHub Pages root now serves the migrated `小系統` console, matching `public/index.html`.

## Routes

- GitHub Pages `/` serves the migrated `小系統` web UI.
- Worker `/` serves the same migrated web UI from `public/index.html`.
- `/api/rpc/:method` replaces `google.script.run`.
- `/calendar?p=query&cid=...` is the migrated calendar iframe entry.
- `/health` reports Worker status and storage mode.

## LIFF

- App name: `小系統`
- LIFF ID: `1660923784-6YnGSECs`
- LIFF URL: `https://liff.line.me/1660923784-6YnGSECs`
- Type: `Full`
- GitHub Pages endpoint: `https://fangwl591021.github.io/mylittlesys/`

## Default Login

- Admin: `admin / admin123`
- Demo: `demo / demo123`

Set `ADMIN_USER` and `ADMIN_PASS` in Cloudflare Worker variables before production use.

## Storage

The Worker can run immediately without bindings, using per-isolate memory storage for first deployment checks.
For production persistence, create a Cloudflare KV namespace and bind it as `MYLITTLESYS_KV` in `wrangler.toml`.

## Deploy

```powershell
npm.cmd install
npx.cmd wrangler deploy
```
