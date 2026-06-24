# Self-host the Recall mobile companion

Recall desktop is standalone and does not require this service. Use the mobile companion only if you want encrypted capture and read-only memory browsing from a phone outside your local network.

The companion consists of a static PWA on Cloudflare Pages, a Worker API, and a D1 database. Memory content is encrypted before upload. D1 receives ciphertext, IVs, random identifiers, and timestamps—not the encryption key.

## Prerequisites

- A Cloudflare account
- Node.js 22.5 or newer
- Wrangler authentication (`npx wrangler login`)

## 1. Create D1 and configure the Worker

```bash
cd workers-sync
npm ci
npx wrangler d1 create recall-mobile-sync
```

Copy `wrangler.example.toml` to `wrangler.toml`. Replace:

- `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID printed by Wrangler.
- `REPLACE_WITH_YOUR_PAGES_PROJECT` with the Pages project name you will create below.

`wrangler.toml` is intentionally ignored by Git because it identifies your Cloudflare resources.

Initialize and deploy:

```bash
npx wrangler d1 execute recall-mobile-sync --remote --file=schema.sql
npm run type-check
npx wrangler deploy
```

Record the resulting Worker URL, for example `https://your-worker.workers.dev`.

## 2. Build and deploy the PWA

From the repository root:

```bash
npm ci
```

macOS/Linux:

```bash
VITE_MOBILE_MODE=true \
VITE_SYNC_API_URL=https://your-worker.workers.dev \
npm run build:ui
```

PowerShell:

```powershell
$env:VITE_MOBILE_MODE = "true"
$env:VITE_SYNC_API_URL = "https://your-worker.workers.dev"
npm run build:ui
```

Create and deploy the Pages project:

```bash
npx wrangler pages project create recall-mobile
npx wrangler pages deploy dist/ui --project-name recall-mobile --branch main
```

If the final Pages URL differs from `PAGES_ORIGIN` in `workers-sync/wrangler.toml`, update it and redeploy the Worker. The exact origin restriction is required for browser access.

Rebuild the normal desktop UI afterward if you use the same checkout:

```bash
npm run build
```

## 3. Pair a phone

1. Start desktop Recall with `recall serve --open`.
2. Open **Settings → Mobile capture**.
3. Enter your Worker and Pages URLs.
4. Create the encrypted inbox and scan the QR code.
5. In Chrome on Android, choose **Install app**.
6. Use **Sync now** on desktop to publish the first encrypted library snapshot.

Desktop Recall polls for captures and publishes an updated snapshot every minute while running. The phone caches the last decrypted snapshot locally for offline browsing.

## Share from Google Keep and other Android apps

Google Keep does not provide a supported general-purpose notes API. Recall uses Android’s standard Share target instead:

1. Open a note in Google Keep.
2. Choose **Share** or **Send via other apps**.
3. Select **Recall**.
4. Review the prefilled content and save it.

The same flow works with browsers, voice recorders, messaging apps, and other applications that share text or URLs.

## Security and operational notes

- The QR fragment contains a random 256-bit AES key and inbox access token. URL fragments are not sent in HTTP requests to Pages.
- AES-256-GCM encryption occurs before network transmission.
- The Worker stores only encrypted capture payloads and encrypted library snapshots.
- Captures are deleted after desktop import; abandoned ciphertext expires after 30 days.
- Anyone with the full pairing link can read future encrypted snapshots and submit captures. Treat it as a secret and re-pair if exposed.
- Cloudflare account credentials are never required by the running Recall desktop or mobile applications.
- This design provides confidentiality from the relay but does not replace device security or a tested backup strategy.
