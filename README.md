# My Cinema

A private, local-first movie library with optional Jellyfin integration.

## Run locally

From the `personal-cinema` directory:

```powershell
python -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

## Jellyfin connection

Open **Jellyfin** in the sidebar and enter your server URL and account. The password is used only for authentication. The returned session token stays in `sessionStorage` and is removed when the browser session ends.

If the app is hosted over HTTPS, Jellyfin must also be available over HTTPS and configured to allow the app's origin. Browsers block an HTTPS page from loading an HTTP video server.

## Local movies

Use **Add local movies** to select video files from the device. The browser plays them directly; they are not uploaded. Selected files remain available only until the page is closed or refreshed.
