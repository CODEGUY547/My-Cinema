import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const root = resolve("dist");
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const cache = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;

function loadLocalEnv() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadLocalEnv();

const tmdbToken = process.env.TMDB_READ_ACCESS_TOKEN?.trim() || "";
const genres = new Map([
  [28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"],
  [80, "Crime"], [99, "Documentary"], [18, "Drama"], [10751, "Family"],
  [14, "Fantasy"], [36, "History"], [27, "Horror"], [10402, "Music"],
  [9648, "Mystery"], [10749, "Romance"], [878, "Science Fiction"],
  [10770, "TV Movie"], [53, "Thriller"], [10752, "War"], [37, "Western"]
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function normalizedTitle(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resultScore(movie, title, year) {
  let score = Math.log10((movie.vote_count || 0) + 1);
  if (normalizedTitle(movie.title) === normalizedTitle(title)) score += 50;
  if (normalizedTitle(movie.original_title) === normalizedTitle(title)) score += 35;
  const releaseYear = Number(movie.release_date?.slice(0, 4));
  if (year && releaseYear === year) score += 25;
  if (year && releaseYear && Math.abs(releaseYear - year) === 1) score += 8;
  if (movie.poster_path) score += 6;
  return score;
}

function cleanMovie(movie) {
  const releaseYear = Number(movie.release_date?.slice(0, 4)) || null;
  const genreNames = movie.genres?.map(genre => genre.name).filter(Boolean)
    || (movie.genre_ids || []).map(id => genres.get(id)).filter(Boolean);
  return {
    tmdbId: movie.id,
    title: movie.title || movie.original_title,
    originalTitle: movie.original_title || null,
    year: releaseYear,
    releaseDate: movie.release_date || null,
    overview: movie.overview || "",
    genre: genreNames[0] || null,
    genres: genreNames,
    rating: movie.vote_average ? Number(movie.vote_average.toFixed(1)) : null,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
    tmdbUrl: `https://www.themoviedb.org/movie/${movie.id}`
  };
}

async function upcomingMovies(region = "UG") {
  const today = new Date();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 365);
  const isoDate = value => value.toISOString().slice(0, 10);
  const discovery = await tmdbRequest("/discover/movie", {
    region,
    include_adult: "false",
    include_video: "false",
    "release_date.gte": isoDate(today),
    "release_date.lte": isoDate(end),
    with_release_type: "3|2",
    sort_by: "popularity.desc",
    page: 1
  });
  const inWindow = movie => movie.release_date >= isoDate(today) && movie.release_date <= isoDate(end);
  let results = (discovery.results || []).filter(inWindow);
  if (results.length < 10) {
    const broader = await tmdbRequest("/discover/movie", {
      include_adult: "false",
      include_video: "false",
      "primary_release_date.gte": isoDate(today),
      "primary_release_date.lte": isoDate(end),
      with_release_type: "3|2",
      sort_by: "popularity.desc",
      page: 1
    });
    results = [...results, ...(broader.results || [])];
  }
  return [...new Map(results.filter(inWindow).map(movie => [movie.id, movie])).values()]
    .sort((a, b) => a.release_date.localeCompare(b.release_date) || (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 18)
    .map(cleanMovie);
}

async function tmdbRequest(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  Object.entries({ language: "en-US", ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tmdbToken}`, Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`TMDb returned ${response.status}`);
  return response.json();
}

async function findMovie(searchParams) {
  const tmdbId = searchParams.get("tmdbId")?.trim();
  const title = searchParams.get("title")?.trim();
  const year = Number(searchParams.get("year")) || null;
  const cacheKey = tmdbId ? `id:${tmdbId}` : `search:${normalizedTitle(title)}:${year || ""}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.value;

  let movie;
  if (/^\d+$/.test(tmdbId || "")) {
    movie = await tmdbRequest(`/movie/${tmdbId}`);
  } else {
    if (!title || title.length > 180) return null;
    const data = await tmdbRequest("/search/movie", {
      query: title,
      year: year || undefined,
      include_adult: "false",
      page: 1
    });
    movie = (data.results || []).sort((a, b) => resultScore(b, title, year) - resultScore(a, title, year))[0];
  }
  const value = movie ? cleanMovie(movie) : null;
  cache.set(cacheKey, { savedAt: Date.now(), value });
  return value;
}

async function handleApi(response, url) {
  if (url.pathname === "/api/tmdb/status") {
    return sendJson(response, 200, { enabled: Boolean(tmdbToken) });
  }
  if (!tmdbToken) return sendJson(response, 503, { error: "TMDb is not configured" });
  try {
    if (url.pathname === "/api/tmdb/upcoming") {
      const requestedRegion = url.searchParams.get("region")?.toUpperCase() || "UG";
      const region = /^[A-Z]{2}$/.test(requestedRegion) ? requestedRegion : "UG";
      return sendJson(response, 200, { region, movies: await upcomingMovies(region) });
    }
    if (url.pathname !== "/api/tmdb/movie") return sendJson(response, 404, { error: "Not found" });
    const movie = await findMovie(url.searchParams);
    if (!movie) return sendJson(response, 404, { error: "No matching movie found" });
    return sendJson(response, 200, movie);
  } catch (error) {
    console.error("TMDb request failed:", error.message);
    return sendJson(response, 502, { error: "TMDb lookup failed" });
  }
}

async function serveStatic(response, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (url.pathname.startsWith("/api/")) return handleApi(response, url);
  return serveStatic(response, url);
});

server.listen(port, host, () => {
  console.log(`My Cinema: http://localhost:${port}`);
  console.log(`TMDb metadata: ${tmdbToken ? "enabled" : "not configured — add TMDB_READ_ACCESS_TOKEN to .env.local"}`);
});
