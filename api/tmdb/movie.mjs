import { findMovie } from "../_tmdb.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  response.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
  if (!process.env.TMDB_READ_ACCESS_TOKEN?.trim()) {
    return response.status(503).json({ error: "TMDb is not configured" });
  }
  try {
    const url = new URL(request.url, "https://my-cinema.invalid");
    const movie = await findMovie(url.searchParams);
    if (!movie) return response.status(404).json({ error: "No matching movie found" });
    return response.status(200).json(movie);
  } catch (error) {
    console.error("TMDb request failed", error instanceof Error ? error.message : "Unknown error");
    return response.status(502).json({ error: "TMDb lookup failed" });
  }
}
