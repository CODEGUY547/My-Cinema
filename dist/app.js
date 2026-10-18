const demoMovies = [
  { id: "demo-1", title: "The Last Matatu", year: 2025, genre: "Drama", runtime: "1h 48m", theme: 0, progress: 64, source: "demo" },
  { id: "demo-2", title: "Kampala After Dark", year: 2024, genre: "Action", runtime: "2h 06m", theme: 1, progress: 31, source: "demo" },
  { id: "demo-3", title: "Sunday at the Lake", year: 2026, genre: "Comedy", runtime: "1h 32m", theme: 2, source: "demo" },
  { id: "demo-4", title: "The Green Hills", year: 2023, genre: "Drama", runtime: "1h 57m", theme: 3, source: "demo" },
  { id: "demo-5", title: "Midnight Frequency", year: 2025, genre: "Action", runtime: "1h 44m", theme: 4, source: "demo" },
  { id: "demo-6", title: "Home Again", year: 2026, genre: "Comedy", runtime: "1h 39m", theme: 5, source: "demo" },
  { id: "demo-7", title: "The Quiet Road", year: 2022, genre: "Drama", runtime: "2h 12m", theme: 1, source: "demo" },
  { id: "demo-8", title: "Red Dust", year: 2024, genre: "Action", runtime: "1h 51m", theme: 0, source: "demo" }
];

const state = {
  movies: [...demoMovies],
  view: "home",
  filter: "all",
  query: "",
  favorites: new Set(JSON.parse(localStorage.getItem("my-cinema-favorites") || "[]")),
  currentMovie: null,
  jellyfin: null,
  objectUrls: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const movieGrid = $("#movieGrid");
const continueGrid = $("#continueGrid");
const emptyState = $("#emptyState");
const settingsDialog = $("#settingsDialog");
const playerDialog = $("#playerDialog");
const videoPlayer = $("#videoPlayer");

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function posterMarkup(movie, index) {
  if (movie.image) return `<img class="poster-image" src="${escapeHtml(movie.image)}" alt="">`;
  return `<div class="poster-art theme-${movie.theme ?? index % 6}" data-letter="${escapeHtml(movie.title.charAt(0))}"><span class="poster-word">${escapeHtml(movie.title)}</span></div>`;
}

function filteredMovies() {
  return state.movies.filter(movie => {
    const matchesView = state.view !== "favorites" || state.favorites.has(movie.id);
    const matchesGenre = state.filter === "all" || movie.genre === state.filter;
    const haystack = `${movie.title} ${movie.genre} ${movie.year}`.toLowerCase();
    return matchesView && matchesGenre && haystack.includes(state.query.toLowerCase());
  });
}

function renderMovies() {
  const movies = filteredMovies();
  movieGrid.innerHTML = movies.map((movie, index) => `
    <article class="movie-card">
      <div class="poster">
        ${posterMarkup(movie, index)}
        <button class="favorite-button ${state.favorites.has(movie.id) ? "active" : ""}" data-favorite="${movie.id}" aria-label="${state.favorites.has(movie.id) ? "Remove from" : "Add to"} favorites">${state.favorites.has(movie.id) ? "♥" : "♡"}</button>
        <button class="play-button" data-play="${movie.id}" aria-label="Play ${escapeHtml(movie.title)}">▶</button>
      </div>
      <div class="movie-info">
        <h3 title="${escapeHtml(movie.title)}">${escapeHtml(movie.title)}</h3>
        <p>${escapeHtml(String(movie.year || "Movie"))} · ${escapeHtml(movie.genre || "Unsorted")} · ${escapeHtml(movie.runtime || "")}</p>
      </div>
    </article>`).join("");
  emptyState.hidden = movies.length > 0;
}

function renderContinue() {
  const movies = state.movies.filter(movie => movie.progress > 0).slice(0, 2);
  $("#continueSection").hidden = movies.length === 0;
  continueGrid.innerHTML = movies.map((movie, index) => `
    <button class="continue-card" data-play="${movie.id}" style="text-align:left;color:inherit;padding:0;cursor:pointer">
      <div class="continue-visual theme-${movie.theme ?? index % 6}">${movie.image ? `<img class="poster-image" src="${escapeHtml(movie.image)}" alt="">` : `<span>${escapeHtml(movie.title.charAt(0))}</span>`}</div>
      <div class="continue-copy">
        <h3>${escapeHtml(movie.title)}</h3>
        <p>${movie.progress}% watched · ${escapeHtml(movie.runtime || "")}</p>
        <div class="progress"><span style="width:${movie.progress}%"></span></div>
      </div>
    </button>`).join("");
}

function updateView() {
  $$(".nav-item[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  $("#libraryTitle").textContent = state.view === "favorites" ? "Your favorites" : "Your library";
  $("#libraryKicker").textContent = state.view === "favorites" ? "SAVED FOR LATER" : "CURATED FOR YOU";
  if (state.view !== "home") document.querySelector(".content-section:last-of-type").scrollIntoView({ behavior: "smooth", block: "start" });
  renderMovies();
}

function saveFavorites() {
  localStorage.setItem("my-cinema-favorites", JSON.stringify([...state.favorites]));
}

function openPlayer(movie) {
  state.currentMovie = movie;
  $("#playerTitle").textContent = movie.title;
  $("#playerSource").textContent = movie.source === "jellyfin" ? "JELLYFIN LIBRARY" : movie.source === "local" ? "LOCAL FILE" : "DEMO TITLE";
  if (!movie.videoUrl) {
    showToast("Add a local file or connect Jellyfin to play a movie");
    return;
  }
  videoPlayer.src = movie.videoUrl;
  playerDialog.hidden = false;
  document.body.style.overflow = "hidden";
  videoPlayer.play().catch(() => {});
}

function closePlayer() {
  videoPlayer.pause();
  videoPlayer.removeAttribute("src");
  videoPlayer.load();
  playerDialog.hidden = true;
  document.body.style.overflow = "";
}

function addLocalFiles(files) {
  const videos = [...files].filter(file => file.type.startsWith("video/"));
  if (!videos.length) return;
  const added = videos.map((file, index) => {
    const objectUrl = URL.createObjectURL(file);
    state.objectUrls.push(objectUrl);
    return {
      id: `local-${Date.now()}-${index}`,
      title: file.name.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " "),
      year: new Date().getFullYear(),
      genre: "Local",
      runtime: formatBytes(file.size),
      theme: (state.movies.length + index) % 6,
      source: "local",
      videoUrl: objectUrl
    };
  });
  state.movies = [...added, ...state.movies];
  state.view = "library";
  updateView();
  showToast(`${added.length} local movie${added.length === 1 ? "" : "s"} added for this session`);
}

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function ticksToRuntime(ticks) {
  if (!ticks) return "";
  const minutes = Math.round(ticks / 600000000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function deviceId() {
  let id = localStorage.getItem("my-cinema-device");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `browser-${Date.now()}`;
    localStorage.setItem("my-cinema-device", id);
  }
  return id;
}

function normalizeServerUrl(url) {
  return url.trim().replace(/\/+$/, "");
}

async function connectJellyfin(event) {
  event.preventDefault();
  const status = $("#connectionStatus");
  const button = $("#connectButton");
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Connecting…";
  const baseUrl = normalizeServerUrl($("#serverUrl").value);
  try {
    const response = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `MediaBrowser Client="My Cinema", Device="Web browser", DeviceId="${deviceId()}", Version="1.0.0"`
      },
      body: JSON.stringify({ Username: $("#username").value, Pw: $("#password").value })
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Username or password was not accepted." : `Server returned ${response.status}.`);
    const auth = await response.json();
    state.jellyfin = { baseUrl, token: auth.AccessToken, userId: auth.User.Id, name: auth.User.Name };
    sessionStorage.setItem("my-cinema-jellyfin", JSON.stringify(state.jellyfin));
    $("#password").value = "";
    await loadJellyfinLibrary();
    settingsDialog.hidden = true;
    document.body.style.overflow = "";
    showToast(`Connected to ${state.jellyfin.name}'s Jellyfin library`);
  } catch (error) {
    status.textContent = `${error.message} Check HTTPS, CORS and the server address.`;
  } finally {
    button.disabled = false;
    button.textContent = "Connect library";
  }
}

async function loadJellyfinLibrary() {
  if (!state.jellyfin) return;
  const { baseUrl, token, userId } = state.jellyfin;
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie",
    Fields: "Overview,Genres,RunTimeTicks,PrimaryImageAspectRatio,UserData",
    SortBy: "SortName",
    SortOrder: "Ascending"
  });
  const response = await fetch(`${baseUrl}/Users/${userId}/Items?${params}`, { headers: { "X-Emby-Token": token } });
  if (!response.ok) throw new Error("Could not load the Jellyfin library.");
  const data = await response.json();
  const jellyfinMovies = (data.Items || []).map((item, index) => ({
    id: `jf-${item.Id}`,
    jellyfinId: item.Id,
    title: item.Name,
    year: item.ProductionYear || "Movie",
    genre: item.Genres?.[0] || "Unsorted",
    runtime: ticksToRuntime(item.RunTimeTicks),
    theme: index % 6,
    source: "jellyfin",
    progress: item.UserData?.PlayedPercentage ? Math.round(item.UserData.PlayedPercentage) : 0,
    image: item.ImageTags?.Primary ? `${baseUrl}/Items/${item.Id}/Images/Primary?maxWidth=600&quality=88&tag=${encodeURIComponent(item.ImageTags.Primary)}&api_key=${encodeURIComponent(token)}` : "",
    videoUrl: `${baseUrl}/Videos/${item.Id}/stream?Static=true&api_key=${encodeURIComponent(token)}`
  }));
  state.movies = [...jellyfinMovies, ...state.movies.filter(movie => movie.source !== "jellyfin")];
  state.view = "library";
  renderContinue();
  updateView();
}

function disconnectJellyfin() {
  state.jellyfin = null;
  sessionStorage.removeItem("my-cinema-jellyfin");
  state.movies = state.movies.filter(movie => movie.source !== "jellyfin");
  $("#connectionStatus").textContent = "Disconnected.";
  renderContinue();
  renderMovies();
}

document.addEventListener("click", event => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    event.stopPropagation();
    const id = favorite.dataset.favorite;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    saveFavorites();
    renderMovies();
    return;
  }
  const play = event.target.closest("[data-play]");
  if (play) {
    const movie = state.movies.find(item => item.id === play.dataset.play);
    if (movie) openPlayer(movie);
  }
});

$$(".nav-item[data-view]").forEach(button => button.addEventListener("click", () => {
  state.view = button.dataset.view;
  $(".sidebar").classList.remove("open");
  updateView();
}));
$$(".filter").forEach(button => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  $$(".filter").forEach(item => item.classList.toggle("active", item === button));
  renderMovies();
}));
$("#searchInput").addEventListener("input", event => { state.query = event.target.value; renderMovies(); });
$("#addFilesButton").addEventListener("click", () => $("#fileInput").click());
$("#heroAddButton").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", event => addLocalFiles(event.target.files));
function openSettings() {
  settingsDialog.hidden = false;
  document.body.style.overflow = "hidden";
  $("#serverUrl").focus();
}
function closeSettings() {
  settingsDialog.hidden = true;
  document.body.style.overflow = "";
}
$("#settingsButton").addEventListener("click", openSettings);
$("#avatarButton").addEventListener("click", openSettings);
$("#heroConnectButton").addEventListener("click", openSettings);
$("#settingsClose").addEventListener("click", closeSettings);
$("#mobileMenu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#jellyfinForm").addEventListener("submit", connectJellyfin);
$("#disconnectButton").addEventListener("click", disconnectJellyfin);
$("#playerClose").addEventListener("click", closePlayer);
playerDialog.addEventListener("click", event => { if (event.target === playerDialog) closePlayer(); });
settingsDialog.addEventListener("click", event => { if (event.target === settingsDialog) closeSettings(); });
window.addEventListener("beforeunload", () => state.objectUrls.forEach(URL.revokeObjectURL));

try {
  const savedConnection = JSON.parse(sessionStorage.getItem("my-cinema-jellyfin") || "null");
  if (savedConnection) {
    state.jellyfin = savedConnection;
    $("#serverUrl").value = savedConnection.baseUrl;
    loadJellyfinLibrary().catch(() => disconnectJellyfin());
  }
} catch {}

renderContinue();
renderMovies();
