# SCANTY SOCIAL BOOST — Cloudflare starter

A white-and-blue, GHS-denominated social media marketing storefront built for Cloudflare Workers + D1.

## Included
- Responsive marketing website and service catalogue
- Customer registration, login and session cookies
- Order creation and customer order history
- Admin setup endpoint, admin overview, service management and order status updates
- Paystack transaction initialization, server-side verification and signed webhook handling
- Cloudflare D1 schema and starter service catalogue

The starter lists legitimate marketing services (strategy, content, design, campaign setup and account management). It is not designed to sell fake followers, likes, views or subscribers.

## 1. Requirements
- Cloudflare account
- Node.js 20+ and npm
- Wrangler CLI (`npm install -g wrangler`)
- Paystack account with GHS payments enabled for live checkout

## 2. Install and create the database
```bash
npm install
npx wrangler login
npx wrangler d1 create scanty-social-boost
```
Copy the returned database ID into `wrangler.toml` where it says `REPLACE_WITH_D1_DATABASE_ID`.

Create the D1 tables and starter services:
```bash
npx wrangler d1 execute scanty-social-boost --remote --file=./schema.sql
```

For local development, use:
```bash
npx wrangler d1 execute scanty-social-boost --local --file=./schema.sql
```

## 3. Configure secrets
```bash
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put ADMIN_SETUP_KEY
```
Use your Paystack **secret** key, never the public key. Use a long random value for `ADMIN_SETUP_KEY`. Do not commit secrets to GitHub.

## 4. Create the first administrator
Deploy the Worker, then call this once from a trusted terminal. Replace the domain and values:
```bash
curl -X POST https://YOUR-WORKER-DOMAIN/api/admin/setup \
  -H "Content-Type: application/json" \
  -H "x-setup-key: YOUR_ADMIN_SETUP_KEY" \
  -d '{"name":"Site Administrator","email":"you@example.com","password":"USE-A-UNIQUE-PASSWORD-OF-14-CHARS-OR-MORE"}'
```
After creating the admin, remove/rotate the `ADMIN_SETUP_KEY` secret to prevent further admin creation through the setup endpoint. The endpoint will no longer work without it.

Sign in through the website with that administrator email and password. The same account UI will show the admin overview.

## 5. Configure Paystack webhook
In your Paystack dashboard, add:
`https://YOUR-WORKER-DOMAIN/api/payments/webhook`

Use the same Paystack secret key in Cloudflare. Test with Paystack test keys first. Switch to live credentials only after a successful test transaction and webhook verification. Paystack availability and supported payment channels depend on your merchant account and country configuration.

## 6. Run locally
```bash
npm install
npx wrangler dev
```
Open the local URL printed by Wrangler. For local API testing, set local secrets using `.dev.vars` (do not commit this file):
```text
PAYSTACK_SECRET_KEY=sk_test_your_test_secret
ADMIN_SETUP_KEY=use-a-long-random-local-secret
```

## 7. Deploy
```bash
npx wrangler deploy
```
The Worker serves the static site from `public/` and routes `/api/*` to the backend. Attach your custom domain in Cloudflare Workers & Pages after deployment.

## 8. Important launch checklist
- Replace the example business email in the footer with a monitored address.
- Add your business legal name, contact details, privacy notice, terms, cancellation/refund policy and service delivery terms before accepting public orders.
- Confirm the correct GHS pricing, tax treatment and service scope.
- Test registration, login, order creation, Paystack test checkout, webhook and admin status updates.
- Set up backups/export for D1 and restrict Cloudflare dashboard access.
- Add rate limiting/Turnstile and email verification before opening registration widely.
- Add customer support and order notification delivery before production launch.
- Review the privacy and consumer-protection requirements applicable to your business.

## API summary
- `GET /api/health`
- `GET /api/services`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/orders`
- `GET /api/orders`
- `POST /api/payments/verify`
- `POST /api/payments/webhook`
- `POST /api/admin/setup` (protected by `ADMIN_SETUP_KEY`)
- `GET /api/admin/overview` (admin only)
- `PATCH /api/admin/orders/status` (admin only)
- `POST /api/admin/services` (admin only)
- `PATCH /api/admin/services/toggle` (admin only)
