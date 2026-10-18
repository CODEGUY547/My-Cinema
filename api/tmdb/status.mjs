export default function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ enabled: Boolean(process.env.TMDB_READ_ACCESS_TOKEN?.trim()) });
}
