# Convex backend (Auth + RevenueCat)

This repo uses Convex for storing Broski user identity + subscription state.

## HTTP endpoints

- `POST /auth/google` → sign in with Google `idToken`
- `POST /auth/apple` → sign in with Apple `identityToken`
- `POST /auth/signout` → revoke session
- `GET /me` → fetch current user (requires session)
- `POST /webhooks/revenuecat` → RevenueCat webhook (server-to-server)

Base URL is your Convex HTTP Actions URL (example from `ids-n-all.md`): `https://loyal-shark-391.convex.site`

## Convex env vars (required)

Set these in Convex:

```bash
npx convex env set APPLE_CLIENT_ID "com.muzammil.broski"
npx convex env set GOOGLE_OAUTH_CLIENT_IDS "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
npx convex env set REVENUECAT_WEBHOOK_SECRET "YOUR_REVENUECAT_WEBHOOK_SECRET"
```

Optional:

```bash
npx convex env set APP_SESSION_TTL_DAYS "90"
```

## Notes

- RevenueCat webhooks should send an `Authorization` header matching `REVENUECAT_WEBHOOK_SECRET`.
- The Flutter app uses the returned `sessionToken` (stored in secure storage) for all subsequent Convex calls.

