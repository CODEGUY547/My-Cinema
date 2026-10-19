# My Cinema

A personal streaming interface backed by Jellyfin, with automatic TMDB metadata and a shared-PIN guest gateway.

## Run locally

From the `personal-cinema` directory:

```powershell
npm start
```

Then open `http://localhost:4173`.

## Automatic TMDB metadata

My Cinema can securely enrich Jellyfin movies with current TMDB titles, years, genres, ratings, summaries, backdrops, and posters.

1. Request an **API Read Access Token** from the API section of your TMDB account settings.
2. Copy `.env.example` to `.env.local`.
3. Replace the placeholder in `.env.local` with your token.
4. Restart `npm start`.

The token is read only by the local Node server and is never sent to the browser or committed to Git. When Jellyfin provides a TMDB ID, My Cinema uses that exact record; otherwise it searches using the cleaned title and release year.

## Public shared-PIN setup

The public Vercel site never receives a Jellyfin administrator password or token. A small gateway runs on the Jellyfin PC, signs in to the restricted `Friends` Jellyfin user over localhost, and exposes only PIN-protected library, image, and streaming endpoints through Tailscale Funnel.

Requirements:

- A non-administrator Jellyfin user named `Friends`, limited to the libraries guests may watch.
- Tailscale installed and signed in on the Jellyfin PC.
- A content licence that permits sharing the movies with the intended viewers.
- The PC and Jellyfin server must remain powered on while friends are watching.

Initial setup:

```powershell
npm run gateway:init
npm run gateway
```

`gateway:init` prints a six-digit PIN once. The PIN hash and signing key are saved in the ignored `.gateway-secrets.json` file and must never be committed. Set `PUBLIC_GATEWAY_URL` and `CINEMA_PUBLIC_ORIGINS` in `.env.local`, then expose the gateway with Tailscale Funnel on local port `4180`.

The gateway rate-limits incorrect PIN attempts, grants 12-hour browser sessions, and issues short-lived signed URLs for posters and streams. Movie data remains on the Jellyfin PC.

## Deploy on Vercel

The `dist` folder is the static site and `api/tmdb` contains the Vercel Functions used for automatic movie metadata.

1. Import `CODEGUY547/My-Cinema` into Vercel.
2. Set the Output Directory to `dist`.
3. Add `TMDB_READ_ACCESS_TOKEN` as a Secret environment variable for Production and Preview.
4. Deploy.

For shared-PIN playback, the site connects to the HTTPS gateway URL. Do not expose Jellyfin port `8096` directly to the public internet.

## Direct Jellyfin connection

Open **Jellyfin** in the sidebar and enter your server URL and account. The password is used only for authentication. The returned session token stays in `sessionStorage` and is removed when the browser session ends.

If the app is hosted over HTTPS, Jellyfin must also be available over HTTPS and configured to allow the app's origin. Browsers block an HTTPS page from loading an HTTP video server.

Direct Jellyfin sign-in remains available in the source for private/local use, but public guests should use the shared PIN so Jellyfin credentials and tokens are never given to them.

## Local movies

Use **Add local movies** to select video files from the device. The browser plays them directly; they are not uploaded. Selected files remain available only until the page is closed or refreshed.
