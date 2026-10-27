# Installable PWA

Solaris is a Progressive Web App: the same codebase installs on phones and desktops, and the app shell opens without a connection.

## What is cached (and what is not)

| Resource | Strategy | Why |
|---|---|---|
| App shell pages (`/`, `/citizen`, `/command-center`, `/mesh`, `/offline.html`) | Precached on install; navigations are network-first with cache, then `/offline.html`, as fallback | The simulators and dashboard shell open with no network. |
| `/_next/static/*`, `/icons/*` | Cache-first | Immutable, hashed assets. |
| OpenStreetMap tiles | Cache-first, capped at 300 tiles | Areas already viewed still render offline; the cap bounds storage. |
| **`/api/*`** | **Never cached** (network only) | These responses carry SOS data and locations. Nothing sensitive is written to the browser cache. |
| **Any non-GET request** | **Never cached** | SOS packets and dispatch actions must reach the server or fail visibly. |

The cache name is versioned (`solaris-*-v1`); bumping `VERSION` in `public/sw.js` removes old caches on activation.

The service worker is registered only in production builds (set `NEXT_PUBLIC_PWA_DEV=1` to test it in `npm run dev`). While offline, a visible badge says "Offline — SOS will be sent when the connection returns".

## Installing

- **Android (Chrome):** open the site, menu → *Install app* (or *Add to Home screen*).
- **iOS (Safari):** Share → *Add to Home Screen*.
- **Desktop (Chrome/Edge):** click the install icon in the address bar, or menu → *Install Solaris*.

The app opens at `/citizen` in standalone mode; the command center is reachable at `/command-center`.

## Honest limits

- Browsers cannot run a **background Bluetooth mesh**: relaying SOS packets between phones while the app is closed needs a native app. That is on the roadmap, not in this MVP (the mesh is simulated at `/mesh`).
- The offline shell lets the citizen simulator *open*; submitting an SOS still needs the server. A queue that retries on reconnect is not implemented yet.
- iOS limits service-worker storage and may evict caches of rarely used PWAs.
- Icons are simple generated black-and-white placeholders until the design system lands.
