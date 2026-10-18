const genres = new Map([
  [28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"],
  [80, "Crime"], [99, "Documentary"], [18, "Drama"], [10751, "Family"],
  [14, "Fantasy"], [36, "History"], [27, "Horror"], [10402, "Music"],
  [9648, "Mystery"], [10749, "Romance"], [878, "Science Fiction"],
  [10770, "TV Movie"], [53, "Thriller"], [10752, "War"], [37, "Western"]
]);

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
    overview: movie.overview || "",
    genre: genreNames[0] || null,
    genres: genreNames,
    rating: movie.vote_average ? Number(movie.vote_average.toFixed(1)) : null,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
    tmdbUrl: `https://www.themoviedb.org/movie/${movie.id}`
  };
}

async function tmdbRequest(pathname, params = {}) {
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("TMDb is not configured");
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  Object.entries({ language: "en-US", ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`TMDb returned ${response.status}`);
  return response.json();
}

export async function findMovie(searchParams) {
  const tmdbId = searchParams.get("tmdbId")?.trim();
  const title = searchParams.get("title")?.trim();
  const year = Number(searchParams.get("year")) || null;

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
  return movie ? cleanMovie(movie) : null;
}
