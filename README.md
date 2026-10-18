# My Cinema

A private, local-first movie library with optional Jellyfin integration.

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

## Jellyfin connection

Open **Jellyfin** in the sidebar and enter your server URL and account. The password is used only for authentication. The returned session token stays in `sessionStorage` and is removed when the browser session ends.

If the app is hosted over HTTPS, Jellyfin must also be available over HTTPS and configured to allow the app's origin. Browsers block an HTTPS page from loading an HTTP video server.

## Local movies

Use **Add local movies** to select video files from the device. The browser plays them directly; they are not uploaded. Selected files remain available only until the page is closed or refreshed.
