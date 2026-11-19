/* Maluti Play is managed by the administrator.
   The browser stores account data and settings in localStorage, and video files in IndexedDB. */
"use strict";

// App settings and local storage keys
const KEYS = {
  users: "maluti_users", titles: "maluti_titles", removed: "maluti_removed_ids", admin: "maluti_admin",
  session: "maluti_session", settings: "maluti_settings", messages: "maluti_messages", listPrefix: "maluti_list_"
};
const DEFAULTS = { name: "Maluti Play", tagline: "Stories from the Mountain Kingdom: movies, series, reels and short videos." };
const FLAGS = [["featured", "Featured"], ["trending", "Trending"], ["isNew", "New"], ["recommended", "Recommended"], ["reel", "Reel"]];

// Current app data and open title
let titles = [];                         // every title (loaded from localStorage)
let session = read(KEYS.session, null);  // {role:"member", id} | {role:"admin"} | null
let currentId = null;                    // title open in the modal
let objUrls = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Read and write JSON data in the browser
function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast("Browser storage is blocked or full."); }
}
const getUsers = () => read(KEYS.users, []);
const saveUsers = (u) => write(KEYS.users, u);
const getSettings = () => ({ ...DEFAULTS, ...read(KEYS.settings, {}) });
const getStore = () => read(KEYS.titles, []);
function saveStore(list) { write(KEYS.titles, list); titles = list; }
const listKey = () => KEYS.listPrefix + (session && session.role === "member" ? session.id : session && session.role === "admin" ? "admin" : "guest");
const getList = () => read(listKey(), []);

// Create and check salted password hashes
function cyrb53(str, seed = 0) {      // small fallback hash for browsers without crypto.subtle
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
const hasSubtle = () => !!(window.crypto && window.crypto.subtle && window.TextEncoder);
function newSalt() {
  const a = new Uint8Array(12);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a); else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hashPass(pass, salt, algo) {
  const data = salt + ":" + pass;
  if ((algo || (hasSubtle() ? "s2" : "c1")) === "s2") {
    if (!hasSubtle()) return "";
    const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
    return "s2:" + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return "c1:" + cyrb53(data);
}
async function makeCredential(pass) { const salt = newSalt(); return { salt, hash: await hashPass(pass, salt) }; }
async function passMatches(pass, rec) { return !!rec.hash && (await hashPass(pass, rec.salt, rec.hash.slice(0, 2))) === rec.hash; }
// Default administrator account details use a salted hash, not a plain-text password.
const DEFAULT_ADMIN = { name: "Administrator", email: "admin", salt: "mlt-adm-7f3a", s2: "s2:f0618214baacc51da00e33e1ec5cce06820f072c12205a5534c6aa19acac4075", c1: "c1:1b03ea46624e95" };
// Add these sample members unless an administrator has removed them.
const SEED_MEMBERS = [{ id: "u-lerato", name: "Lerato", username: "lerato", email: "lerato@maluti.ls", salt: "mlt-mem-9c21", s2: "s2:b39be3807ec70310f45e3fff3478f49b71a87f1b469c5d3bc0785f4cdcac0163", c1: "c1:1a9d122b886a17" }];
function seedMembers() {
  const users = getUsers(), removed = read(KEYS.removed, []);
  let changed = false;
  for (const m of SEED_MEMBERS) {
    if (users.some(u => u.id === m.id) || removed.includes(m.id)) continue;
    users.push({ id: m.id, name: m.name, username: m.username, email: m.email, salt: m.salt, hash: hasSubtle() ? m.s2 : m.c1, status: "approved", joined: new Date().toISOString() });
    changed = true;
  }
  if (changed) saveUsers(users);
}
function getAdmin() {
  const saved = read(KEYS.admin, null);          // Saved when the admin changes the password in Settings
  if (saved) return saved;
  return { name: DEFAULT_ADMIN.name, email: DEFAULT_ADMIN.email, salt: DEFAULT_ADMIN.salt, hash: hasSubtle() ? DEFAULT_ADMIN.s2 : DEFAULT_ADMIN.c1 };
}
const getMessages = () => read(KEYS.messages, []);

// Store uploaded video files in IndexedDB
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("maluti_files", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function putFile(id, blob) {
  const db = await openDB();
  return new Promise((res, rej) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function getFile(id) {
  const db = await openDB();
  return new Promise((res, rej) => { const q = db.transaction("files").objectStore("files").get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function delFile(id) { try { const db = await openDB(); db.transaction("files", "readwrite").objectStore("files").delete(id); } catch (e) { /* ignore */ } }
const fileIdsOf = (t) => [t.fileId, ...(t.episodes || []).map(e => e.fileId)].filter(Boolean);

// Make a poster image from an uploaded image file
function fileToPoster(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = 300; c.height = 450;
      const r = Math.max(300 / img.width, 450 / img.height), w = img.width * r, h = img.height * r;
      c.getContext("2d").drawImage(img, (300 - w) / 2, (450 - h) / 2, w, h);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    img.src = url;
  });
}

// Shared formatting, validation, and access helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(m) { $("#toastBody").textContent = m; bootstrap.Toast.getOrCreateInstance($("#appToast"), { delay: 2800 }).show(); }
function msg(el, ok, text) { el.innerHTML = `<div class="${ok ? "ok" : "err"}">${text}</div>`; }
const emailOK = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function isHttpUrl(v) { try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch (e) { return false; } }
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const isAdmin = () => !!session && session.role === "admin";
const currentMember = () => session && session.role === "member" ? getUsers().find(u => u.id === session.id) : null;
const canWatch = () => isAdmin() || !!currentMember();
const newId = (p) => p + Date.now() + Math.random().toString(36).slice(2, 6);
function requireAdmin() { if (isAdmin()) return true; toast("Administrator access required."); return false; }

function placeholderPoster(title) {
  let hue = 0;
  for (const ch of title) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="hsl(${hue},45%,28%)"/><circle cx="150" cy="150" r="62" fill="hsl(${hue},60%,70%)" opacity=".8"/><text x="150" y="300" text-anchor="middle" font-family="Georgia,serif" font-size="26" font-weight="bold" fill="#fff">${esc(title.slice(0, 18))}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
const posterOf = (t) => t.poster || placeholderPoster(t.title);

// Load the published catalogue, or use fallback data if it is unavailable
async function loadCatalogue() {
  $("#status").innerHTML = '<p class="notice" role="status">Loading catalogue…</p>';
  let published = [], failed = false;
  try {
    const res = await fetch("data/titles.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    published = await res.json();
  } catch (err) {
    failed = true;
    console.warn("Fetch failed, using fallback data:", err);
    published = typeof FALLBACK_TITLES !== "undefined" ? FALLBACK_TITLES : [];
  }
  $("#status").innerHTML = "";
  seedFromPublished(Array.isArray(published) ? published : []);
  renderAll();
  if (failed && titles.length === 0) $("#status").innerHTML = '<p class="notice" role="alert">We couldn\'t load the catalogue right now. Please refresh the page or try again later.</p>';
}
// Copy published titles into local storage without restoring titles the admin removed.
function seedFromPublished(list) {
  const store = getStore(), removed = read(KEYS.removed, []);
  let added = false;
  for (const t of list) {
    const id = String(t.id);
    if (!store.some(x => String(x.id) === id) && !removed.includes(id)) { store.push({ ...t, id }); added = true; }
  }
  if (added) saveStore(store); else titles = store;
}

// Identify whether a video link can be embedded or should open separately
function playerInfo(rawUrl) {
  let u;
  try { u = new URL(rawUrl, location.href); } catch (e) { return { kind: "none" }; }
  const host = u.hostname.replace(/^www\./, "");
  let yt = null;
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") yt = u.searchParams.get("v");
    else if (/^\/(embed|shorts)\//.test(u.pathname)) yt = u.pathname.split("/")[2];
  } else if (host === "youtu.be") yt = u.pathname.slice(1);
  if (yt && /^[\w-]{6,15}$/.test(yt)) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1`, link: u.href };
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (/^\d+$/.test(id)) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}?autoplay=1`, link: u.href };
  }
  if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { kind: "video", src: u.href, link: u.href };
  return { kind: "link", link: u.href };
}

// Build the cards used for titles and reels
const stampClass = (t) => t.type === "Short" ? "short" : t.type === "Series" ? "series" : "";
function cardHTML(t, full) {
  const inList = getList().includes(String(t.id));
  return `<article class="title-card" data-id="${esc(t.id)}">
    <span class="stamp ${stampClass(t)}">${esc(t.type)}</span>
    <img src="${esc(posterOf(t))}" alt="Poster for ${esc(t.title)}" loading="lazy" width="300" height="450">
    <div class="card-body-nl">
      <p class="card-genre">${esc(t.genre)}</p>
      <h3 class="card-title">${esc(t.title)}</h3>
      <p class="card-meta">${esc(t.year)} &middot; ${esc(t.duration || "")}</p>
      ${full ? `<p class="card-desc">${esc(t.description)}</p>` : ""}
      <div class="card-actions">
        <button class="btn-nl btn-nl-brass btn-nl-sm" data-action="details" type="button" aria-label="Details for ${esc(t.title)}">Details</button>
        <button class="btn-nl btn-nl-outline btn-nl-sm ${inList ? "in-list" : ""}" data-action="toggle" type="button" aria-pressed="${inList}">${inList ? "&#10003; In List" : "+ My List"}</button>
      </div>
    </div>
  </article>`;
}
function reelHTML(t) {
  return `<button class="reel-card" type="button" data-reel="${esc(t.id)}" aria-label="Play reel: ${esc(t.title)}">
    <img src="${esc(posterOf(t))}" alt="" loading="lazy"><span class="reel-play" aria-hidden="true">&#9654;</span>
    <span class="reel-info"><strong>${esc(t.title)}</strong><span>${esc(t.genre)}</span></span></button>`;
}
function renderCards(sel, list, full) {
  let html = "";
  for (const t of list) html += cardHTML(t, full);
  $(sel).innerHTML = html;
}
const newestFirst = (flag) => titles.filter(t => t[flag]).reverse();

// Update the page content from the saved app data
function applySettings() {
  const s = getSettings();
  $("#brandMark").textContent = s.name;
  $$(".site-name").forEach(el => el.textContent = s.name);
  $("#homeTitle").textContent = "Welcome to " + s.name;
  $("#homeTagline").textContent = s.tagline;
}

function renderHome() {
  const f = [...titles].reverse().find(t => t.featured);
  const hero = $("#hero");
  hero.hidden = !f;
  if (f) {
    hero.innerHTML = `<img src="${esc(posterOf(f))}" alt="Poster for ${esc(f.title)}">
      <div><p class="hero-tag">Featured</p><h2>${esc(f.title)}</h2>
      <p class="hero-meta">${esc(f.genre)} &middot; ${esc(f.type)} &middot; ${esc(f.year)} &middot; ${esc(f.duration || "")}</p>
      <p class="hero-desc">${esc(f.description)}</p>
      <div class="hero-actions"><button class="btn-nl btn-nl-brass" type="button" data-hero="watch">&#9654; Watch</button>
      <button class="btn-nl btn-nl-outline" type="button" data-hero="info">More info</button></div></div>`;
    hero.dataset.id = f.id;
  }
  const sections = [["#sec-trending", "#rowTrending", "trending"], ["#sec-new", "#rowNew", "isNew"], ["#sec-rec", "#rowRec", "recommended"]];
  for (const [sec, row, flag] of sections) {
    const list = newestFirst(flag);
    $(sec).hidden = list.length === 0;
    renderCards(row, list, false);
  }
  const reels = newestFirst("reel");
  $("#sec-reels").hidden = reels.length === 0;
  $("#rowReels").innerHTML = reels.map(reelHTML).join("");

  const empty = $("#homeEmpty");
  const anyShown = f || sections.some(([, , fl]) => newestFirst(fl).length) || reels.length;
  empty.hidden = !!anyShown;
  if (!anyShown) {
    empty.innerHTML = titles.length === 0
      ? (isAdmin() ? 'The catalogue is empty. <a href="#admin">Open the Admin Panel</a> and add your first title.' : "The administrator has not added any titles yet. Please check back soon.")
      : (isAdmin() ? 'Nothing is shown on this page yet. In Admin Panel &rarr; Catalogue, switch on Featured, Trending, New, Recommended or Reel for your titles.' : `There are ${titles.length} titles in <a href="#browse">Browse</a>.`);
  }
}

function fillFilters() {
  const genres = [...new Set(titles.map(t => t.genre))].sort();
  const types = [...new Set(titles.map(t => t.type))].sort();
  const g = $("#genreFilter"), ty = $("#typeFilter"), gv = g.value, tv = ty.value;
  g.innerHTML = '<option value="all">All genres</option>' + genres.map(x => `<option>${esc(x)}</option>`).join("");
  ty.innerHTML = '<option value="all">All types</option>' + types.map(x => `<option>${esc(x)}</option>`).join("");
  if (genres.includes(gv)) g.value = gv;
  if (types.includes(tv)) ty.value = tv;
  $("#genreList").innerHTML = genres.map(x => `<option value="${esc(x)}">`).join("");
}
function getFiltered() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const genre = $("#genreFilter").value, type = $("#typeFilter").value, sort = $("#sortSelect").value;
  const out = [];
  for (const t of titles) {
    const okText = q === "" || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    if (okText && (genre === "all" || t.genre === genre) && (type === "all" || t.type === type)) out.push(t);
  }
  if (sort === "added") out.reverse();
  else if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "newest") out.sort((a, b) => b.year - a.year);
  else out.sort((a, b) => a.year - b.year);
  return out;
}
function renderBrowse() {
  const list = getFiltered();
  renderCards("#catalogueGrid", list, true);
  $("#resultCount").textContent = `Showing ${list.length} of ${titles.length} titles`;
  $("#noResults").hidden = list.length > 0;
}
function renderReels() {
  const reels = newestFirst("reel");
  $("#reelGrid").innerHTML = reels.map(reelHTML).join("");
  $("#reelsEmpty").hidden = reels.length > 0;
}
function renderMyList() {
  const ids = getList();
  const saved = titles.filter(t => ids.includes(String(t.id)));
  renderCards("#listGrid", saved, true);
  $("#listEmpty").hidden = saved.length > 0;
  $("#clearList").hidden = saved.length === 0;
  $("#listCount").textContent = saved.length;
}

// Show the correct account details and controls for the active session.
function renderSession() {
  const m = currentMember();
  if (session && session.role === "member" && !m) { session = null; localStorage.removeItem(KEYS.session); }
  const admin = isAdmin();
  $("#brandSub").textContent = admin ? "Administrator" : m ? "Member" : "Log in to watch";
  $("#accountLabel").textContent = (admin || m) ? "My Account" : "Log In / Sign Up";
  $("#adminNavItem").hidden = !admin;
  $("#sessionBar").hidden = !(admin || m);
  $("#sessionName").textContent = admin ? (getAdmin() ? getAdmin().name : "Administrator") : m ? m.name : "";
  $("#memberLoggedOut").hidden = !!m || admin;
  $("#adminLoginForm").hidden = admin;
  $("#memberLoggedIn").hidden = !m;
  $("#adminCard").hidden = !admin;
  if (m) $("#profileMeta").innerHTML = `<dt>Name</dt><dd>${esc(m.name)}</dd><dt>Email</dt><dd>${esc(m.email)}</dd><dt>Member since</dt><dd>${fmtDate(m.joined)}</dd><dt>Status</dt><dd><span class="status-tag">${esc(m.status)}</span></dd>`;
}

// Build the administrator dashboard and its lists
function renderAdmin() {
  if (!isAdmin()) return;
  const users = getUsers(), pending = users.filter(u => u.status === "pending");
  $("#adminStats").innerHTML = [
    ["Members", users.filter(u => u.status === "approved").length, ""],
    ["Awaiting approval", pending.length, pending.length ? "warn" : ""],
    ["Titles online", titles.length, ""],
    ["Reels", titles.filter(t => t.reel).length, ""],
    ["Unread messages", getMessages().filter(m => !m.read).length, getMessages().some(m => !m.read) ? "warn" : ""]
  ].map(([l, n, c]) => `<div class="stat-card ${c}"><span class="stat-num">${n}</span><span class="stat-label">${l}</span></div>`).join("");
  $("#tcApprovals").textContent = pending.length;
  $("#tcMembers").textContent = users.length;
  $("#tcTitles").textContent = titles.length;
  const msgs = getMessages(), unread = msgs.filter(m => !m.read).length;
  $("#tcMessages").textContent = unread;
  const attention = pending.length + unread;
  const pill = $("#pendingPill"); pill.hidden = attention === 0; pill.textContent = attention;
  $("#messageList").innerHTML = msgs.length ? [...msgs].reverse().map(m => `
    <div class="approval-card"><div><h3>${esc(m.name)} ${m.read ? "" : '<span class="status-tag pending">new</span>'}</h3>
    <span class="mono text-soft">${esc(m.email)} &middot; ${fmtDate(m.date)}</span><p class="mb-0 mt-2">${esc(m.text)}</p></div>
    <div class="row-actions">${m.read ? "" : `<button class="btn-nl btn-nl-brass btn-nl-sm" data-act="msg-read" data-id="${esc(m.id)}" type="button">Mark read</button>`}
    <button class="btn-nl btn-nl-danger btn-nl-sm" data-act="msg-delete" data-id="${esc(m.id)}" type="button">Delete</button></div></div>`).join("")
    : '<p class="notice">No messages yet. Messages sent from the About &amp; Help page arrive here.</p>';

  $("#approvalList").innerHTML = pending.length ? pending.map(u => `
    <div class="approval-card"><div><h3>${esc(u.name)}</h3><span class="mono text-soft">${esc(u.email)} &middot; applied ${fmtDate(u.joined)}</span></div>
    <div class="row-actions"><button class="btn-nl btn-nl-brass btn-nl-sm" data-act="approve" data-id="${esc(u.id)}" type="button">Approve</button>
    <button class="btn-nl btn-nl-danger btn-nl-sm" data-act="reject" data-id="${esc(u.id)}" type="button">Reject</button></div></div>`).join("")
    : '<p class="notice">No applications waiting. New sign-ups will appear here.</p>';

  $("#memberRows").innerHTML = users.length ? users.map(u => `<tr>
    <td>${esc(u.name)}</td><td class="mono">${esc(u.email)}</td><td class="mono">${fmtDate(u.joined)}</td>
    <td><span class="status-tag ${esc(u.status)}">${esc(u.status)}</span></td>
    <td><div class="row-actions">
      ${u.status === "approved" ? `<button class="btn-nl btn-nl-outline btn-nl-sm" data-act="suspend" data-id="${esc(u.id)}" type="button">Suspend</button>` : `<button class="btn-nl btn-nl-brass btn-nl-sm" data-act="approve" data-id="${esc(u.id)}" type="button">Approve</button>`}
      <button class="btn-nl btn-nl-danger btn-nl-sm" data-act="remove-user" data-id="${esc(u.id)}" type="button">Remove</button></div></td></tr>`).join("")
    : '<tr class="empty-row"><td colspan="5">No members yet.</td></tr>';

  $("#titleRows").innerHTML = titles.length ? [...titles].reverse().map(titleRow).join("")
    : '<tr class="empty-row"><td colspan="5">No titles yet. Open the Add Title tab to upload your first one.</td></tr>';
}
function titleRow(t) {
  const parts = [];
  if (t.fileId) parts.push("Uploaded file"); else if (t.watch) parts.push("Link");
  if ((t.episodes || []).length) parts.push(t.episodes.length + " episodes");
  const chips = FLAGS.map(([f, label]) => `<button class="chip" type="button" data-act="flag" data-flag="${f}" data-id="${esc(t.id)}" aria-pressed="${!!t[f]}">${label}</button>`).join("");
  return `<tr><td>${esc(t.title)}</td><td>${esc(t.type)}</td><td class="mono">${esc(parts.join(" + ") || "none")}</td>
    <td><div class="chip-row" role="group" aria-label="Placement for ${esc(t.title)}">${chips}</div></td>
    <td><div class="row-actions"><button class="btn-nl btn-nl-outline btn-nl-sm" data-act="edit-title" data-id="${esc(t.id)}" type="button">Edit</button>
    <button class="btn-nl btn-nl-danger btn-nl-sm" data-act="delete-title" data-id="${esc(t.id)}" type="button">Delete</button></div></td></tr>`;
}
function setAdminTab(name) {
  $$(".admin-tab").forEach(b => { const on = b.dataset.tab === name; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  $$(".admin-pane").forEach(p => p.hidden = p.id !== "tab-" + name);
  if (name === "settings") { const s = getSettings(); $("#stName").value = s.name; $("#stTagline").value = s.tagline; }
}

// Prepare and validate the administrator's title form
function resetTitleForm() {
  $("#titleForm").reset();
  $("#tfEditId").value = ""; $("#episodeList").innerHTML = ""; $("#tfCurrentFile").innerHTML = "";
  $("#episodeBox").hidden = true;
  $("#titleFormHead").textContent = "Add a movie, series, reel or short";
  $("#tfSubmit").textContent = "Add title"; $("#tfCancel").hidden = true;
}
function toggleEpisodeBox() {
  const series = $("#tfType").value === "Series";
  $("#episodeBox").hidden = !series;
  if (series && !$("#episodeList").children.length) addEpisodeRow();
}
function addEpisodeRow(ep = {}) {
  const div = document.createElement("div");
  div.className = "episode-edit";
  div.dataset.fileid = ep.fileId || ""; div.dataset.filename = ep.fileName || "";
  div.innerHTML = `<div class="row g-2">
    <div class="col-12 col-md-3 field"><span class="lbl">Episode name</span><input class="ep-name" type="text" maxlength="60" aria-label="Episode name" value="${esc(ep.name || "")}"></div>
    <div class="col-12 col-md-4 field"><span class="lbl">Video link</span><input class="ep-url" type="url" placeholder="https://..." aria-label="Episode video link" value="${esc(ep.watch || "")}"></div>
    <div class="col-9 col-md-4 field"><span class="lbl">or upload file</span><input class="ep-file" type="file" accept="video/*" aria-label="Episode video file">${ep.fileId ? `<small class="text-soft">Current: ${esc(ep.fileName)}</small>` : ""}</div>
    <div class="col-3 col-md-1 field d-flex align-items-end"><button type="button" class="btn-nl btn-nl-danger btn-nl-sm ep-remove" aria-label="Remove episode">&#10005;</button></div></div>`;
  $("#episodeList").appendChild(div);
}
async function saveTitle(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  const out = $("#titleFormMsg");
  const f = {
    title: $("#tfTitle").value.trim(), type: $("#tfType").value, genre: $("#tfGenre").value.trim(),
    year: Number($("#tfYear").value), duration: $("#tfDuration").value.trim(),
    description: $("#tfDesc").value.trim(), watch: $("#tfWatch").value.trim(), download: $("#tfDownload").value.trim()
  };
  const posterUrl = $("#tfPoster").value.trim(), posterFile = $("#tfPosterFile").files[0], mainFile = $("#tfFile").files[0];
  const editId = $("#tfEditId").value;
  const existing = editId ? titles.find(t => String(t.id) === editId) : null;
  const MAX = 200 * 1024 * 1024;
  // Check all required fields and uploaded files before saving anything.
  if (f.title.length < 2) return msg(out, false, "Please enter a title.");
  if (!f.genre) return msg(out, false, "Please enter a genre.");
  if (!(f.year >= 1900 && f.year <= 2030)) return msg(out, false, "Year must be between 1900 and 2030.");
  if (f.description.length < 10) return msg(out, false, "Description must be at least 10 characters.");
  if (f.watch && !isHttpUrl(f.watch)) return msg(out, false, "The watch link must start with http:// or https://");
  if (f.download && !isHttpUrl(f.download)) return msg(out, false, "The download link must start with http:// or https://");
  if (posterUrl && !isHttpUrl(posterUrl)) return msg(out, false, "The poster link must start with http:// or https://");
  if (posterFile && !posterFile.type.startsWith("image/")) return msg(out, false, "The poster must be an image file.");
  if (mainFile && (!mainFile.type.startsWith("video/") || mainFile.size > MAX)) return msg(out, false, "The video must be a video file under 200 MB.");

  const eps = [];
  // Series can have multiple episodes, each with a link or an uploaded file.
  if (f.type === "Series") {
    for (const row of $$("#episodeList .episode-edit")) {
      const name = row.querySelector(".ep-name").value.trim(), url = row.querySelector(".ep-url").value.trim();
      const file = row.querySelector(".ep-file").files[0], oldId = row.dataset.fileid;
      if (!name && !url && !file && !oldId) continue;
      if (url && !isHttpUrl(url)) return msg(out, false, "Episode links must start with http:// or https://");
      if (file && (!file.type.startsWith("video/") || file.size > MAX)) return msg(out, false, "Episode files must be videos under 200 MB.");
      if (!url && !file && !oldId) return msg(out, false, "Each episode needs a video link or an uploaded file.");
      eps.push({ name: name || "Episode " + (eps.length + 1), watch: url, fileId: oldId, fileName: row.dataset.filename, _file: file });
    }
  }
  const keepMain = existing && existing.fileId && !mainFile && !($("#tfRemoveFile") && $("#tfRemoveFile").checked);
  if (!f.watch && !mainFile && !keepMain && eps.length === 0)
    return msg(out, false, "Add a video: upload a file, paste a watch link, or (for a series) add at least one episode.");

  try {
    msg(out, true, "Saving…");
    // Keep existing files unless they are replaced or removed in the form.
    let fileId = keepMain ? existing.fileId : "", fileName = keepMain ? existing.fileName : "";
    if (mainFile) { fileId = newId("f"); await putFile(fileId, mainFile); fileName = mainFile.name; }
    for (const ep of eps) {
      if (ep._file) { ep.fileId = newId("f"); await putFile(ep.fileId, ep._file); ep.fileName = ep._file.name; }
      delete ep._file;
    }
    const poster = posterFile ? await fileToPoster(posterFile) : (posterUrl || (existing && existing.poster) || "");
    const item = {
      ...f, poster, episodes: eps, fileId, fileName, allowDownload: $("#tfAllowDownload").checked,
      featured: $("#tfFeatured").checked, trending: $("#tfTrending").checked, isNew: $("#tfNew").checked,
      recommended: $("#tfRecommended").checked, reel: $("#tfReel").checked,
      credit: existing ? existing.credit || "" : ""
    };
    const store = getStore();
    // Only one title can be featured at a time.
    if (item.featured) store.forEach(t => t.featured = false);
    if (existing) {
      const i = store.findIndex(t => String(t.id) === editId);
      store[i] = { ...store[i], ...item };
      const keep = fileIdsOf(item); fileIdsOf(existing).filter(id => !keep.includes(id)).forEach(delFile);
      toast("Title updated.");
    } else {
      store.push({ id: newId("t"), ...item });
      toast(`"${f.title}" added.`);
    }
    saveStore(store);
    resetTitleForm(); out.innerHTML = "";
    renderAll(); setAdminTab("titles");
  } catch (err) {
    console.error(err);
    msg(out, false, "Could not save. The browser storage may be full or blocked (try a smaller video).");
  }
}
function editTitle(id) {
  const t = titles.find(x => String(x.id) === id);
  if (!t) return;
  resetTitleForm();
  $("#tfEditId").value = t.id; $("#tfTitle").value = t.title; $("#tfType").value = t.type; $("#tfGenre").value = t.genre;
  $("#tfYear").value = t.year; $("#tfDuration").value = t.duration || ""; $("#tfDesc").value = t.description;
  $("#tfPoster").value = t.poster && !t.poster.startsWith("data:") ? t.poster : "";
  $("#tfWatch").value = t.watch || ""; $("#tfDownload").value = t.download || "";
  $("#tfAllowDownload").checked = !!t.allowDownload;
  $("#tfFeatured").checked = !!t.featured; $("#tfTrending").checked = !!t.trending; $("#tfNew").checked = !!t.isNew;
  $("#tfRecommended").checked = !!t.recommended; $("#tfReel").checked = !!t.reel;
  if (t.fileId) $("#tfCurrentFile").innerHTML = `Current file: ${esc(t.fileName)} <label class="check"><input type="checkbox" id="tfRemoveFile"> remove it</label>`;
  if (t.type === "Series") { $("#episodeBox").hidden = false; (t.episodes || []).forEach(addEpisodeRow); if (!(t.episodes || []).length) addEpisodeRow(); }
  $("#titleFormHead").textContent = "Edit title"; $("#tfSubmit").textContent = "Save changes"; $("#tfCancel").hidden = false;
  setAdminTab("addtitle");
}

// Export and import titles as a JSON catalogue
function exportCatalogue() {
  const out = []; let skipped = 0;
  for (const t of getStore()) {
    const c = { ...t };
    const eps = (c.episodes || []).filter(e => e.watch).map(e => ({ name: e.name, watch: e.watch }));
    if (!c.watch && eps.length === 0) { skipped++; continue; }   // Uploaded files are stored only in this browser.
    delete c.fileId; delete c.fileName; c.allowDownload = false; c.episodes = eps;
    out.push(c);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
  a.download = "titles.json"; document.body.appendChild(a); a.click(); a.remove();
  toast(`Exported ${out.length} titles.` + (skipped ? ` ${skipped} skipped (uploaded files only; use links to publish).` : ""));
}
async function importCatalogue(file) {
  const out = $("#importMsg");
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("not a list");
    const store = getStore(); let n = 0;
    for (const t of data) {
      if (!t || !t.title || !t.genre || !t.year || !t.description) continue;
      let id = String(t.id || newId("t"));
      if (store.some(x => String(x.id) === id)) id = newId("t");
      store.push({ ...t, id, fileId: "", fileName: "", episodes: t.episodes || [] }); n++;
    }
    saveStore(store); renderAll();
    msg(out, true, `Imported ${n} titles.`);
  } catch (e) { msg(out, false, "That file is not a valid titles.json catalogue."); }
}

// Display title details and control video playback
const revokeUrls = () => { objUrls.forEach(u => URL.revokeObjectURL(u)); objUrls = []; };
const hasMain = (t) => !!(t.watch || t.fileId);
const itemDownloadable = (it, t) => it.fileId ? !!t.allowDownload : !!it.download;
const curTitle = () => titles.find(x => String(x.id) === String(currentId));

function renderEpisodes(t) {
  const eps = t.episodes || [], box = $("#modalEpisodes");
  if (!eps.length) { box.hidden = true; box.innerHTML = ""; return; }
  const ok = canWatch();
  box.hidden = false;
  box.innerHTML = '<h3 class="section-title">Episodes</h3>' + eps.map((ep, i) => `
    <div class="episode-row"><span><span class="mono text-soft">${String(i + 1).padStart(2, "0")}</span> ${esc(ep.name || "Episode " + (i + 1))}</span>
    <span class="row-actions"><button class="btn-nl btn-nl-brass btn-nl-sm" data-ep-play="${i}" type="button" ${ok ? "" : "disabled"}>&#9654; Play</button>
    ${ok && itemDownloadable(ep, t) ? `<button class="btn-nl btn-nl-outline btn-nl-sm" data-ep-dl="${i}" type="button">&#8681; Download</button>` : ""}</span></div>`).join("");
}
function updateModalButtons() {
  const t = curTitle();
  if (!t) return;
  const inList = getList().includes(String(t.id));
  const lb = $("#modalListBtn");
  lb.textContent = inList ? "✓ In My List (remove)" : "+ My List";
  lb.classList.toggle("in-list", inList);
  const ok = canWatch(), playable = hasMain(t) || (t.episodes || []).length > 0;
  $("#modalLock").hidden = ok || !playable;
  const wb = $("#modalWatchBtn");
  wb.hidden = !playable; wb.disabled = !ok; wb.textContent = ok ? "▶ Watch" : "🔒 Members only";
  const open = $("#modalOpenLink");
  open.hidden = !(ok && t.watch && !t.fileId);
  if (t.watch) open.href = playerInfo(t.watch).link || t.watch;
  $("#modalDownload").hidden = !(ok && hasMain(t) && itemDownloadable(t, t));
  renderEpisodes(t);
}
function openModal(id, autoplay) {
  const t = titles.find(x => String(x.id) === String(id));
  if (!t) return;
  currentId = t.id;
  $("#modalTitle").textContent = t.title;
  $("#modalPoster").src = posterOf(t); $("#modalPoster").alt = "Poster for " + t.title;
  $("#modalMeta").textContent = `${t.genre} · ${t.type} · ${t.year} · ${t.duration || ""}`;
  $("#modalDesc").textContent = t.description;
  $("#modalCredit").textContent = t.credit ? "Credit: " + t.credit : "";
  revokeUrls(); $("#modalPlayer").innerHTML = ""; $("#modalPlayer").hidden = true;
  updateModalButtons();
  bootstrap.Modal.getOrCreateInstance($("#titleModal")).show();
  if (autoplay && canWatch()) playTitle(t);
}
function playTitle(t) {
  if (hasMain(t)) return playItem(t);
  if ((t.episodes || []).length) return playItem(t.episodes[0]);
}
async function playItem(item) {
  const box = $("#modalPlayer");
  revokeUrls();
  if (item.fileId) {
    let blob = null;
    try { blob = await getFile(item.fileId); } catch (e) { /* show a message if the file is unavailable */ }
    if (!blob) { toast("That uploaded file was not found in this browser."); return; }
    const url = URL.createObjectURL(blob); objUrls.push(url);
    box.innerHTML = `<video controls autoplay playsinline src="${url}">Your browser cannot play this video.</video>`;
    box.hidden = false; return;
  }
  const info = playerInfo(item.watch || "");
  if (info.kind === "iframe") {
    box.innerHTML = `<iframe src="${esc(info.src)}" title="Video player" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`; box.hidden = false;
  } else if (info.kind === "video") {
    box.innerHTML = `<video controls autoplay playsinline src="${esc(info.src)}">Your browser cannot play this video.</video>`; box.hidden = false;
  } else if (info.kind === "link") {
    window.open(info.link, "_blank", "noopener");
    toast("This link can't be embedded, so it opened in a new tab.");
  }
}
async function downloadItem(item, label) {
  let href, name = (label || "video").replace(/[^\w.-]+/g, "_");
  if (item.fileId) {
    let blob = null;
    try { blob = await getFile(item.fileId); } catch (e) { /* show a message if the file is unavailable */ }
    if (!blob) { toast("That uploaded file was not found in this browser."); return; }
    href = URL.createObjectURL(blob); name = item.fileName || name + ".mp4";
    setTimeout(() => URL.revokeObjectURL(href), 15000);
  } else href = new URL(item.download, location.href).href;
  const a = document.createElement("a");
  a.href = href; a.download = name; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

// Add or remove a title from the current user's list
function toggleList(id) {
  id = String(id);
  const list = getList(), t = titles.find(x => String(x.id) === id), i = list.indexOf(id);
  if (i === -1) { list.push(id); toast(`"${t.title}" added to My List`); }
  else { list.splice(i, 1); toast(`"${t.title}" removed from My List`); }
  write(listKey(), list);
  renderAll();
  if (String(currentId) === id) updateModalButtons();
}

// Move the muted banner video to the page currently being shown
function attachBanner(name) {
  const v = $("#bgVideo");
  if (!v) return;
  const head = $(`#view-${name} .page-head`);
  if (head && v.parentElement !== head) head.prepend(v);
  v.muted = true;
  if (navigator.connection && navigator.connection.saveData) return;   // Avoid video when data saving is enabled.
  try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* The poster remains visible if autoplay is blocked. */ }
}

// Switch between pages and update the browser URL's selected view
function showView(name) {
  const valid = ["home", "browse", "reels", "mylist", "account", "about", "admin", "staff"];
  if (!valid.includes(name)) name = "home";
  if (name === "staff") name = isAdmin() ? "admin" : "account";
  if (name === "admin" && !isAdmin()) { name = "account"; setMode("admin"); }
  if (name === "account") setMode(isAdmin() || location.hash === "#staff" ? "admin" : (currentMember() ? "member" : modeNow()));
  $$(".view").forEach(v => v.hidden = v.id !== "view-" + name);
  $$(".nav-tab").forEach(a => {
    const on = a.dataset.view === name;
    a.classList.toggle("active", on);
    on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  const nav = $("#navMenu");
  if (nav.classList.contains("show")) bootstrap.Collapse.getOrCreateInstance(nav).hide();
  const names = { home: "Discover", browse: "Browse", reels: "Reels", mylist: "My List", account: "Account", about: "About & Help", admin: "Admin Panel", staff: "Account" };
  document.title = names[name] + " | " + getSettings().name;
  attachBanner(name);
  window.scrollTo(0, 0);
  if (name === "admin") renderAdmin();
}
const route = () => showView(location.hash.replace("#", "") || "home");
let modeChoice = "member";
const modeNow = () => modeChoice;
function setMode(mode) {
  modeChoice = mode;
  $("#panelMember").hidden = mode !== "member"; $("#panelAdmin").hidden = mode !== "admin";
  $$("[data-mode]").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
}
function setSub(sub) {
  $("#loginForm").hidden = sub !== "login"; $("#signupForm").hidden = sub !== "signup";
  $$("[data-sub]").forEach(b => { const on = b.dataset.sub === sub; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
}
function renderAll() {
  fillFilters(); applySettings();
  renderHome(); renderBrowse(); renderReels(); renderMyList(); renderSession(); renderAdmin();
}
function logout() {
  session = null; localStorage.removeItem(KEYS.session);
  renderAll();
  if (location.hash === "#admin" || location.hash === "#staff") location.hash = "#home";
  route();
  toast("You have been logged out.");
}

// Handle account, title, settings, password, and contact forms
function setupForms() {
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const out = $("#loginMsg"), who = $("#liEmail").value.trim().toLowerCase(), pass = $("#liPass").value;
    if (!who) return msg(out, false, "Please enter your email or username.");
    if (who.includes("@") && !emailOK(who)) return msg(out, false, "Please enter a valid email address.");
    if (pass.length < 6) return msg(out, false, "Password must be at least 6 characters.");
    const u = getUsers().find(x => x.email.toLowerCase() === who || (x.username || "").toLowerCase() === who);
    if (!u || !(await passMatches(pass, u))) return msg(out, false, "Incorrect email or password.");
    if (u.status === "pending") return msg(out, false, "Your application is still waiting for administrator approval.");
    if (u.status === "suspended") return msg(out, false, "This membership is suspended. Please contact the administrator.");
    session = { role: "member", id: u.id }; write(KEYS.session, session);
    e.target.reset(); out.innerHTML = "";
    renderAll(); toast(`Welcome back, ${u.name}!`); location.hash = "#home";
  });
  $("#signupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const out = $("#signupMsg"), name = $("#suName").value.trim(), email = $("#suEmail").value.trim().toLowerCase(), pass = $("#suPass").value;
    if (name.length < 3) return msg(out, false, "Full name must be at least 3 characters.");
    if (!emailOK(email)) return msg(out, false, "Please enter a valid email address.");
    if (pass.length < 6 || !/\d/.test(pass)) return msg(out, false, "Password needs at least 6 characters including a number.");
    const users = getUsers();
    if (users.some(u => u.email.toLowerCase() === email)) return msg(out, false, "That email is already registered.");
    users.push({ id: newId("u"), name, email, ...(await makeCredential(pass)), status: "pending", joined: new Date().toISOString() });
    saveUsers(users); e.target.reset();
    msg(out, true, "Thank you! Your application was sent. You can log in as soon as the administrator approves it.");
    renderAll();
  });
  $("#adminLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const out = $("#adminLoginMsg"), a = getAdmin(), user = $("#adUser").value.trim().toLowerCase();
    if (user !== a.email.toLowerCase() || !(await passMatches($("#adPass").value, a))) return msg(out, false, "Incorrect email or password.");
    session = { role: "admin" }; write(KEYS.session, session);
    e.target.reset(); out.innerHTML = "";
    renderAll(); toast("Signed in."); location.hash = "#admin";
  });
  $("#addMemberForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const out = $("#addMemberMsg"), name = $("#amName").value.trim(), email = $("#amEmail").value.trim().toLowerCase(), pass = $("#amPass").value;
    if (name.length < 3) return msg(out, false, "Name must be at least 3 characters.");
    if (!emailOK(email)) return msg(out, false, "Enter a valid email address.");
    if (pass.length < 6) return msg(out, false, "Password must be at least 6 characters.");
    const users = getUsers();
    if (users.some(u => u.email.toLowerCase() === email)) return msg(out, false, "That email is already registered.");
    users.push({ id: newId("u"), name, email, ...(await makeCredential(pass)), status: "approved", joined: new Date().toISOString() });
    saveUsers(users); e.target.reset(); msg(out, true, `${esc(name)} added and approved.`); renderAll();
  });
  $("#titleForm").addEventListener("submit", saveTitle);
  $("#tfCancel").addEventListener("click", () => { resetTitleForm(); $("#titleFormMsg").innerHTML = ""; });

  $("#settingsForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const out = $("#settingsMsg"), name = $("#stName").value.trim();
    if (name.length < 2) return msg(out, false, "Platform name must be at least 2 characters.");
    write(KEYS.settings, { ...read(KEYS.settings, {}), name, tagline: $("#stTagline").value.trim() });
    renderAll(); msg(out, true, "Settings saved.");
  });
  $("#passForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const out = $("#passMsg"), a = getAdmin(), np = $("#pwNew").value;
    if (!a || !(await passMatches($("#pwOld").value, a))) return msg(out, false, "Current password is incorrect.");
    if (np.length < 8 || !/\d/.test(np)) return msg(out, false, "New password needs at least 8 characters including a number.");
    if (np !== $("#pwNew2").value) return msg(out, false, "The new passwords do not match.");
    write(KEYS.admin, { ...a, ...(await makeCredential(np)) });
    e.target.reset(); msg(out, true, "Password changed.");
  });
  $("#contactForm").addEventListener("submit", e => {
    e.preventDefault();
    const out = $("#contactMsg");
    if ($("#ctName").value.trim().length < 2) return msg(out, false, "Please enter your name.");
    if (!emailOK($("#ctEmail").value.trim())) return msg(out, false, "Please enter a valid email address.");
    if ($("#ctMsg").value.trim().length < 10) return msg(out, false, "Message must be at least 10 characters.");
    const all = getMessages();
    all.push({ id: newId("m"), name: $("#ctName").value.trim(), email: $("#ctEmail").value.trim(), text: $("#ctMsg").value.trim(), date: new Date().toISOString(), read: false });
    write(KEYS.messages, all);
    msg(out, true, "Thank you! Your message has been sent to the administrator.");
    e.target.reset(); renderAdmin();
  });
}

// Apply actions clicked in the administrator dashboard
function adminAction(act, id, flag) {
  if (!requireAdmin()) return;
  let users = getUsers();
  const u = users.find(x => x.id === id);
  if (act === "approve" && u) { u.status = "approved"; saveUsers(users); toast(`${u.name} approved.`); }
  else if (act === "reject" && u) { saveUsers(users.filter(x => x.id !== id)); toast(`${u.name}'s application was rejected.`); }
  else if (act === "suspend" && u) { u.status = "suspended"; saveUsers(users); toast(`${u.name} suspended.`); }
  else if (act === "remove-user" && u) {
    if (!confirm(`Remove ${u.name}? This cannot be undone.`)) return;
    saveUsers(users.filter(x => x.id !== id)); localStorage.removeItem(KEYS.listPrefix + id);
    write(KEYS.removed, [...new Set([...read(KEYS.removed, []), id])]); toast(`${u.name} removed.`);
  } else if (act === "msg-read") {
    const all = getMessages(), m = all.find(x => x.id === id); if (m) { m.read = true; write(KEYS.messages, all); }
  } else if (act === "msg-delete") {
    write(KEYS.messages, getMessages().filter(x => x.id !== id));
  } else if (act === "flag") {
    const store = getStore(), t = store.find(x => String(x.id) === id);
    if (!t) return;
    const on = !t[flag];
    if (flag === "featured" && on) store.forEach(x => x.featured = false);
    t[flag] = on; saveStore(store);
  } else if (act === "delete-title") {
    const t = titles.find(x => String(x.id) === id);
    if (!t || !confirm(`Delete "${t.title}"? This cannot be undone.`)) return;
    saveStore(getStore().filter(x => String(x.id) !== id));
    write(KEYS.removed, [...new Set([...read(KEYS.removed, []), id])]);
    fileIdsOf(t).forEach(delFile); toast(`"${t.title}" deleted.`);
  } else if (act === "edit-title") return editTitle(id);
  renderAll();
}

// Connect page events and load the app when the document is ready
document.addEventListener("click", e => {
  const act = e.target.closest("[data-act]");
  if (act) return adminAction(act.dataset.act, act.dataset.id, act.dataset.flag);
  const hero = e.target.closest("[data-hero]");
  if (hero) return openModal($("#hero").dataset.id, hero.dataset.hero === "watch");
  const reel = e.target.closest("[data-reel]");
  if (reel) return openModal(reel.dataset.reel, true);
  const card = e.target.closest(".title-card");
  if (!card) return;
  const btn = e.target.closest("[data-action]");
  if (btn && btn.dataset.action === "toggle") toggleList(card.dataset.id);
  else openModal(card.dataset.id, false);
});

document.addEventListener("DOMContentLoaded", () => {
  titles = getStore();
  seedMembers();
  ["#searchInput", "#genreFilter", "#typeFilter", "#sortSelect"].forEach(s =>
    $(s).addEventListener(s === "#searchInput" ? "input" : "change", renderBrowse));
  $("#filterForm").addEventListener("submit", e => e.preventDefault());
  $("#resetBtn").addEventListener("click", () => { $("#filterForm").reset(); renderBrowse(); });
  $("#clearList").addEventListener("click", () => { write(listKey(), []); renderAll(); toast("My List cleared."); });
  $("#modalListBtn").addEventListener("click", () => toggleList(currentId));
  $("#modalWatchBtn").addEventListener("click", () => { const t = curTitle(); if (t && canWatch()) playTitle(t); });
  $("#modalDownload").addEventListener("click", () => { const t = curTitle(); if (t && canWatch()) downloadItem(t, t.title); });
  $("#modalEpisodes").addEventListener("click", e => {
    const t = curTitle(); if (!t || !canWatch()) return;
    const p = e.target.closest("[data-ep-play]"), d = e.target.closest("[data-ep-dl]");
    if (p) playItem(t.episodes[Number(p.dataset.epPlay)]);
    if (d) { const ep = t.episodes[Number(d.dataset.epDl)]; downloadItem(ep, ep.name); }
  });
  $("#modalLoginLink").addEventListener("click", () => bootstrap.Modal.getOrCreateInstance($("#titleModal")).hide());
  $("#titleModal").addEventListener("hidden.bs.modal", () => { $("#modalPlayer").innerHTML = ""; revokeUrls(); });
  ["#logoutBtn", "#logoutBtn2", "#logoutBtn3"].forEach(s => $(s).addEventListener("click", logout));
  $$("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $$("[data-sub]").forEach(b => b.addEventListener("click", () => setSub(b.dataset.sub)));
  $$(".admin-tab").forEach(b => b.addEventListener("click", () => setAdminTab(b.dataset.tab)));
  $("#tfType").addEventListener("change", toggleEpisodeBox);
  $("#addEpisodeBtn").addEventListener("click", () => addEpisodeRow());
  $("#episodeList").addEventListener("click", e => { const r = e.target.closest(".ep-remove"); if (r) r.closest(".episode-edit").remove(); });
  $("#exportBtn").addEventListener("click", () => { if (requireAdmin()) exportCatalogue(); });
  $("#importFile").addEventListener("change", e => { const f = e.target.files[0]; if (f && requireAdmin()) importCatalogue(f); e.target.value = ""; });
  setupForms();
  window.addEventListener("hashchange", route);
  renderAll();
  route();
  loadCatalogue();
});
