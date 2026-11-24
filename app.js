'use strict';
/* Équilibre instable : lecteur d'histoires (PWA). Aucun framework, aucun build. */

const APP_VERSION = '2.0.0';
const REPO = { owner: 'khvdovychenko', repo: 'equilibre-instable', branch: 'main' };
const DEFAULT_STORY = 'equilibre-instable';
const LS_STATE = 'equilibre_state_v1';
const LS_TOKEN = 'equilibre_token';
const LS_LIB = 'equilibre_library';
const LS_CHAT = 'equilibre_chat_url'; // seulement sur ce téléphone, jamais envoyé au dépôt
const NEXT_TEXT = 'далі';

const $ = (s, r = document) => r.querySelector(s);
const nowISO = () => new Date().toISOString();

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)
    .map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
}
const hint = (t) => h('small', { class: 'hint' }, t);
const hintIn = (t) => h('small', { style: 'color:inherit;opacity:.75;font-weight:400;margin-left:6px' }, t);

function setColor(el, hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x888888;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  el.style.setProperty('--c', '#' + (m ? m[1] : '888888'));
  el.style.setProperty('--tint', `rgba(${r},${g},${b},.16)`);
  el.style.setProperty('--tint-soft', `rgba(${r},${g},${b},.07)`);
}

/* ---------- Identifiants ---------- */

const ckey = (sid, ch) => `${sid}/${ch}`;                       // clé d'un chapitre : story/chNN
const readerPath = (key) => `reader/${key}.json`;
function normId(id) {                                          // ancien format w03@ch01 -> story/ch01/w03
  const m = /^(w\d+)@(ch\d+)$/.exec(id || '');
  return m ? `${DEFAULT_STORY}/${m[2]}/${m[1]}` : id;
}
function idParts(id) {
  const p = id.split('/');
  return { story: p[0], chapter: p[1], wid: p.slice(2).join('/') };
}
const blankSrs = (due) => ({ status: 'new', interval: 0, due_at: due, reps: 0, lapses: 0, history: [] });

/* ---------- État local (persistant) ---------- */

const blankRec = () => ({
  choice_id: null,
  feedback: { difficulty: null, interest: null, comment: null },
  saved_words: [],
  progress: { last_segment_id: null, completed: false },
  submitted_at: null,
  updated_at: null,
});
const emptyState = () => ({ v: 2, chapters: {}, vocab: { words: {}, deleted: {} }, ui: {}, synced: {}, revision: {}, last_sync: null });

// P = chapitres terminés (toutes les histoires) + 1 : calculé depuis les données reader/, pas depuis un compteur
const computeP = (st) => Object.values((st || state).chapters).filter((r) => r && r.progress && r.progress.completed).length + 1;

function normWord(w, st) {
  const x = Object.assign({}, w);
  x.id = normId(x.id);
  const p = idParts(x.id);
  x.story = x.story || p.story;
  x.chapter_id = x.chapter_id || p.chapter;
  if (!x.srs) x.srs = blankSrs((Number(x.chapter) || computeP(st)) + 1);
  x.srs = Object.assign(blankSrs(0), x.srs);
  if (!Array.isArray(x.srs.history)) x.srs.history = [];
  return x;
}

function migrateV1(s) {
  const n = emptyState();
  n.ui = s.ui || {};
  n.last_sync = s.last_sync || null;
  for (const [k, r] of Object.entries(s.chapters || {})) n.chapters[ckey(DEFAULT_STORY, k)] = r;
  for (const [k, v] of Object.entries(s.synced || {})) n.synced[ckey(DEFAULT_STORY, k)] = v;
  const old = s.vocab || {};
  for (const w of Object.values(old.words || {})) { const x = normWord(w, n); n.vocab.words[x.id] = x; }
  for (const [id, t] of Object.entries(old.deleted || {})) n.vocab.deleted[normId(id)] = t;
  return n;
}
function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_STATE)); } catch (e) { /* état vide */ }
  if (!s) return emptyState();
  if (s.v === 1) s = migrateV1(s);
  if (s.v !== 2) return emptyState();
  const e = emptyState();
  for (const k of Object.keys(e)) if (s[k] == null) s[k] = e[k];
  s.vocab.words = s.vocab.words || {};
  s.vocab.deleted = s.vocab.deleted || {};
  return s;
}
let state = loadState();
function saveState() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { /* stockage plein */ }
}
const getToken = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } };
const getChatUrl = () => { try { return localStorage.getItem(LS_CHAT) || ''; } catch (e) { return ''; } };

const getRec = (key) => state.chapters[key] || blankRec();
function ensureRec(key) { return (state.chapters[key] = state.chapters[key] || blankRec()); }
function touch(key) { const r = ensureRec(key); r.updated_at = nowISO(); return r; }

/* ---------- Synchronisation avec GitHub ---------- */

const statusInfo = { kind: getToken() ? 'wait' : 'local', msg: '' };

function statusText() {
  const t = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const same = d.toDateString() === new Date().toDateString();
    const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return same ? hm : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + hm;
  };
  switch (statusInfo.kind) {
    case 'ok': return 'Synchronisé' + (state.last_sync ? ' · ' + t(state.last_sync) : '');
    case 'sync': return 'Synchronisation…';
    case 'wait': return 'En attente de synchronisation';
    case 'offline': return 'Hors ligne : tout est gardé sur ce téléphone';
    case 'err': return 'Erreur de synchronisation' + (statusInfo.msg ? ' (' + statusInfo.msg + ')' : '');
    default: return 'Pas de jeton : données seulement sur ce téléphone';
  }
}
function setStatus(kind, msg) {
  statusInfo.kind = kind; statusInfo.msg = msg || '';
  document.querySelectorAll('[data-sync]').forEach((e) => {
    e.textContent = statusText();
    if (e.classList.contains('st')) e.className = 'st ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : kind === 'wait' || kind === 'sync' ? 'wait' : '');
  });
}

const b64enc = (s) => btoa(unescape(encodeURIComponent(s)));
const b64dec = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/`;
const ghHeaders = (token, extra) => Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, extra || {});

async function remoteRead(path, token) {
  if (token) {
    const r = await fetch(`${API}${path}?ref=${REPO.branch}`, { headers: ghHeaders(token), cache: 'no-store' });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('jeton refusé');
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    if (j.encoding === 'base64' && j.content) return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
    const raw = await fetch(`${API}${path}?ref=${REPO.branch}`, { headers: ghHeaders(token, { Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' });
    if (!raw.ok) throw new Error('GitHub ' + raw.status);
    return { sha: j.sha, data: await raw.json() };
  }
  const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('lecture ' + r.status);
  return { sha: null, data: await r.json() };
}
async function remoteWrite(path, obj, sha, message, token) {
  const body = { message, content: b64enc(JSON.stringify(obj, null, 2) + '\n'), branch: REPO.branch };
  if (sha) body.sha = sha;
  const r = await fetch(API + path, { method: 'PUT', headers: ghHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return 'conflict';
  if (r.status === 401 || r.status === 403) throw new Error('jeton refusé (droits ?)');
  if (!r.ok) throw new Error('écriture ' + r.status);
  return 'ok';
}

/* chapitre : la version la plus récente (updated_at) gagne */
const ts = (r) => (r && r.updated_at ? Date.parse(r.updated_at) : -1);
function chapterFile(key) {
  const r = getRec(key);
  const { story, chapter } = idParts(key);
  const saved = Object.values(state.vocab.words)
    .filter((w) => w.story === story && w.chapter_id === chapter && !idParts(w.id).wid.startsWith('x-'))
    .map((w) => idParts(w.id).wid).sort();
  return {
    choice_id: r.choice_id,
    feedback: { difficulty: r.feedback.difficulty, interest: r.feedback.interest, comment: r.feedback.comment },
    saved_words: saved,
    progress: { last_segment_id: r.progress.last_segment_id, completed: !!r.progress.completed },
    submitted_at: r.submitted_at,
    updated_at: r.updated_at,
  };
}
function mergeChapterIn(key, remote) {
  if (remote && remote.data && ts(remote.data) > ts(state.chapters[key])) {
    const d = remote.data;
    state.chapters[key] = Object.assign(blankRec(), d, {
      feedback: Object.assign(blankRec().feedback, d.feedback || {}),
      progress: Object.assign(blankRec().progress, d.progress || {}),
    });
  }
}
async function pullChapter(key, token) {                   // lit et fusionne, n'écrit rien
  const remote = await remoteRead(readerPath(key), token);
  mergeChapterIn(key, remote);
  return remote;
}
async function pushChapter(key, token, remote) {           // à appeler après la fusion du dictionnaire (saved_words)
  if (!token || !state.chapters[key]) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const mine = chapterFile(key);
    if (remote && JSON.stringify(mine) === JSON.stringify(remote.data)) { state.synced[key] = mine.updated_at || 'x'; return; }
    const res = await remoteWrite(readerPath(key), mine, remote && remote.sha, `reader: ${key}`, token);
    if (res === 'ok') { state.synced[key] = mine.updated_at || 'x'; return; }
    remote = await pullChapter(key, token);
  }
  throw new Error('conflit');
}

/* dictionnaire : fusion mot par mot */
const lastAt = (s) => (s && s.history && s.history.length ? Date.parse(s.history[s.history.length - 1].at) : -1);
function mergeSrs(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = lastAt(a), tb = lastAt(b);
  if (ta !== tb) return ta > tb ? a : b;               // la dernière évaluation la plus récente gagne
  if (a.reps !== b.reps) return a.reps > b.reps ? a : b;
  if (a.due_at !== b.due_at) return a.due_at > b.due_at ? a : b;
  return a;
}
const CARD_FIELDS = ['lemma', 'pos', 'definition_fr', 'translation_en', 'example', 'cefr'];
function mergeWord(a, b) {
  const base = Date.parse(a.added_at) >= Date.parse(b.added_at) ? a : b;
  const other = base === a ? b : a;
  const out = Object.assign({}, other, base);
  if (a.card_status !== 'pending' || b.card_status !== 'pending') {   // la carte remplie l'emporte sur "pending"
    const ready = a.card_status !== 'pending' ? a : b;
    CARD_FIELDS.forEach((k) => { if (ready[k] != null) out[k] = ready[k]; });
    delete out.card_status;
  }
  out.srs = mergeSrs(a.srs, b.srs);
  return out;
}
function mergeVocab(remote) {
  const L = state.vocab;
  const rw = {};
  (remote.words || []).forEach((w) => { const x = normWord(w, state); rw[x.id] = x; });
  const rd = {};
  (remote.deleted || []).forEach((d) => { rd[normId(d.id)] = d.deleted_at; });
  const ids = new Set([...Object.keys(L.words), ...Object.keys(L.deleted), ...Object.keys(rw), ...Object.keys(rd)]);
  for (const id of ids) {
    const words = [L.words[id], rw[id]].filter(Boolean);
    const dels = [L.deleted[id], rd[id]].filter(Boolean);
    const tw = Math.max(-1, ...words.map((w) => Date.parse(w.added_at)));
    const td = Math.max(-1, ...dels.map((d) => Date.parse(d)));
    if (dels.length && td >= tw) {
      delete L.words[id];
      L.deleted[id] = dels.sort().pop();
    } else if (words.length) {
      L.words[id] = words.length === 2 ? mergeWord(words[0], words[1]) : words[0];
      delete L.deleted[id];
    }
  }
}
function applyCards(cards) {
  if (!cards) return false;
  const src = cards.cards && typeof cards.cards === 'object' ? cards.cards : cards;
  const map = {};
  for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') map[normId(k)] = v;
  const P = computeP();
  let changed = false;
  for (const w of Object.values(state.vocab.words)) {
    if (w.card_status !== 'pending' || !map[w.id]) continue;
    const c = map[w.id];
    CARD_FIELDS.forEach((k) => { if (c[k] != null) w[k] = c[k]; });
    delete w.card_status;
    w.srs.due_at = Math.max(w.srs.due_at, P + 1);
    changed = true;
  }
  return changed;
}
function vocabFile() {
  const words = Object.values(state.vocab.words).sort((a, b) => (a.added_at < b.added_at ? -1 : a.added_at > b.added_at ? 1 : a.id < b.id ? -1 : 1));
  const deleted = Object.entries(state.vocab.deleted).map(([id, deleted_at]) => ({ id, deleted_at })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const stamps = [...words.map((w) => w.added_at), ...words.map((w) => (w.srs.history.length ? w.srs.history[w.srs.history.length - 1].at : null)).filter(Boolean),
    ...deleted.map((d) => d.deleted_at)].sort();
  return { schema_version: '2.0', updated_at: stamps.length ? stamps[stamps.length - 1] : null, words, deleted };
}
async function syncVocab(token, cards) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await remoteRead('reader/vocabulary.json', token);
    if (remote && remote.data) mergeVocab(remote.data);
    applyCards(cards);
    if (!token) return;
    const mine = vocabFile();
    const same = remote && remote.data &&
      JSON.stringify([mine.words, mine.deleted]) === JSON.stringify([remote.data.words || [], remote.data.deleted || []]);
    if (same) return;
    const res = await remoteWrite('reader/vocabulary.json', mine, remote && remote.sha, 'reader: vocabulary', token);
    if (res === 'ok') return;
  }
  throw new Error('conflit');
}

let syncing = false, syncAgain = false, syncTimer = null, syncPromise = Promise.resolve();
const syncHooks = new Set();
function scheduleSync(ms) {
  clearTimeout(syncTimer);
  if (getToken()) setStatus('wait');
  syncTimer = setTimeout(syncNow, ms == null ? 2000 : ms);
}
function syncNow() {
  clearTimeout(syncTimer);
  if (syncing) { syncAgain = true; return syncPromise; }
  syncing = true;
  syncPromise = runSync();
  return syncPromise;
}
async function runSync() {
  const token = getToken();
  const snap = () => JSON.stringify([state.chapters, state.vocab]) + localStorage.getItem(LS_LIB);
  const before = snap();
  setStatus('sync');
  try {
    const lib = await getLibrary();
    const keys = new Set(Object.keys(state.chapters));
    for (const st of lib.stories) for (const c of lib.chapters[st.id] || []) keys.add(ckey(st.id, c.id));
    const remotes = {};
    for (const key of keys) remotes[key] = await pullChapter(key, token);   // d'abord lire les chapitres : P en dépend
    let cards = null;
    try { const r = await remoteRead('lexicon/cards.json', token); cards = r && r.data; } catch (e) { /* pas de cartes */ }
    await syncVocab(token, cards);
    for (const key of keys) await pushChapter(key, token, remotes[key]);    // ensuite écrire (saved_words vient du dictionnaire)
    state.last_sync = nowISO();
    saveState();
    setStatus(token ? 'ok' : 'local');
  } catch (e) {
    saveState();
    setStatus(navigator.onLine ? 'err' : 'offline', navigator.onLine ? e.message : '');
  } finally {
    syncing = false;
    if (snap() !== before && !document.body.classList.contains('reading') && $('#sheet').hidden) route();
    syncHooks.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
}

/* ---------- Données des histoires ---------- */

let libCache = null;
async function getLibrary() {
  let cached = { stories: [], chapters: {} };
  try { const c = JSON.parse(localStorage.getItem(LS_LIB)); if (c && c.stories) cached = c; } catch (e) { /* ignore */ }
  try {
    const r = await fetch('stories/index.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) {
      const idx = await r.json();
      const lib = { stories: idx.stories || [], chapters: {} };
      for (const st of lib.stories) {
        lib.chapters[st.id] = cached.chapters[st.id] || [];
        try {
          const rr = await fetch((st.index || `stories/${st.id}/index.json`) + '?t=' + Date.now(), { cache: 'no-store' });
          if (rr.ok) lib.chapters[st.id] = (await rr.json()).chapters || [];
        } catch (e) { /* on garde la copie locale */ }
      }
      try { localStorage.setItem(LS_LIB, JSON.stringify(lib)); } catch (e) { /* ignore */ }
      return (libCache = lib);
    }
  } catch (e) { /* hors ligne */ }
  return (libCache = cached);
}
const storyTitle = (sid) => {
  const st = libCache && libCache.stories.find((s) => s.id === sid);
  return st ? st.title : sid;
};
const chapterCache = {};
async function getChapter(entry) {
  if (chapterCache[entry.file]) return chapterCache[entry.file];
  const r = await fetch(entry.file);
  if (!r.ok) throw new Error('chapitre ' + r.status);
  return (chapterCache[entry.file] = await r.json());
}
const chStatus = (key) => {
  const r = getRec(key);
  if (r.progress.completed) return 'read';
  return r.progress.last_segment_id ? 'prog' : 'new';
};

/* ---------- Routage ---------- */

let routeSeq = 0, cleanup = null, endHookCleanup = null;
function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (endHookCleanup) { endHookCleanup(); endHookCleanup = null; }
  closeSheet();
  const parts = (location.hash.slice(1) || '/').split('/');
  const name = parts[1] || '';
  const my = ++routeSeq;
  document.body.classList.toggle('reading', name === 'read');
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on',
    (a.dataset.tab === 'library' && (name === '' || name === 'read' || name === 'story')) || a.dataset.tab === name));
  const showErr = (e) => fill($('#view'), h('p', { class: 'empty' }, 'Erreur dans l\'appli : ' + (e && e.message ? e.message : e),
    h('br'), hint('please send this message to Claude')));
  try {
    let p;
    if (name === 'read') {
      const oldStyle = /^ch\d+$/.test(parts[2] || '');
      p = viewReader(oldStyle ? DEFAULT_STORY : parts[2], oldStyle ? parts[2] : parts[3], my);
    } else if (name === 'story') p = viewStory(parts[2], my);
    else if (name === 'words') viewWords();
    else if (name === 'settings') viewSettings();
    else p = viewStories(my);
    if (p && p.catch) p.catch(showErr);
  } catch (e) { showErr(e); }
  if (name !== 'read') window.scrollTo(0, 0);
}

/* ---------- Bouton « Demander la suite » ---------- */

let settingsNote = '';
const isSynced = (key) => {
  const r = state.chapters[key];
  return !!(r && r.progress.completed && getToken() && state.synced[key] === (r.updated_at || 'x'));
};
function copyText(t) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  } catch (e) { /* essai suivant */ }
  return new Promise((resolve, reject) => {
    try {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0' }, t);
      document.body.append(ta);
      ta.select(); ta.setSelectionRange(0, t.length);
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject(new Error('copy'));
    } catch (e) { reject(e); }
  });
}
function askNext(msgEl) {
  const url = getChatUrl();
  if (!url) {
    settingsNote = 'Colle ici le lien de ton chat de génération dans Claude (ouvre ce chat, copie l\'adresse du navigateur, colle-la dans le champ « Lien du chat Claude »). Ensuite reviens et touche « Demander la suite ».';
    location.hash = '#/settings';
    return;
  }
  const p = copyText(NEXT_TEXT);                        // copie et ouverture dans le même geste (sinon iOS bloque l'ouverture)
  try { window.open(url, '_blank'); } catch (e) { location.href = url; }
  p.then(() => { msgEl.textContent = '« ' + NEXT_TEXT + ' » est copié. Colle-le dans le chat.'; })
   .catch(() => { msgEl.textContent = 'Copie impossible : напиши: ' + NEXT_TEXT; });
}
function askNextBlock(key) {
  const msg = h('p', { class: 'ask-msg' });
  if (!isSynced(key)) {
    return h('div', { class: 'ask' }, h('p', { class: 'ask-wait' },
      getToken() ? 'Le bouton « Demander la suite » apparaît dès que ton choix est synchronisé.' : 'Ajoute le jeton dans « Réglages » : le bouton « Demander la suite » apparaîtra après la synchronisation.',
      h('br'), hint('the "ask for the next chapter" button appears once your choice is synced')));
  }
  return h('div', { class: 'ask' },
    h('button', { class: 'btn', onclick: () => askNext(msg) }, 'Demander la suite', hintIn('ask for the next chapter')),
    msg);
}

/* ---------- Histoires et chapitres ---------- */

function refreshButton() {
  const btn = h('button', { class: 'btn ghost refresh', onclick: async () => {
    btn.disabled = true; btn.firstChild.textContent = 'Actualisation…';
    try { await syncNow(); } catch (e) { /* le statut montre l'erreur */ }
    route();
  } }, 'Actualiser', hintIn('refresh: fetch the new chapter'));
  return btn;
}

async function viewStories(my) {
  const v = $('#view');
  fill(v, h('h1', { class: 'page-title' }, 'Histoires'),
    h('p', { class: 'page-sub' }, 'Choisis une histoire. ', hint('pick a story')));
  const lib = await getLibrary();
  if (my !== routeSeq) return;
  v.append(refreshButton());
  if (!lib.stories.length) v.append(h('p', { class: 'empty' }, 'Aucune histoire pour le moment. ', hint('no stories yet')));
  const rows = lib.stories.map((st) => {
    const chs = lib.chapters[st.id] || [];
    const sts = chs.map((c) => chStatus(ckey(st.id, c.id)));
    const read = sts.filter((s) => s === 'read').length;
    const badge = sts.includes('new') ? h('span', { class: 'badge new' }, 'Nouveau')
      : sts.includes('prog') ? h('span', { class: 'badge prog' }, 'En cours')
      : chs.length ? h('span', { class: 'badge read' }, 'À jour ✓') : null;
    return h('a', { class: 'chrow', href: '#/story/' + st.id },
      h('div', { class: 'num cover' }, (st.title || '?').charAt(0)),
      h('div', { class: 't' }, h('b', null, st.title), h('span', null, st.synopsis || ''),
        h('span', { style: 'display:block;margin-top:2px' }, `${read}/${chs.length} chapitres lus`)),
      badge);
  });
  if (rows.length) v.append(h('div', { class: 'chlist' }, rows));
  v.append(h('div', { class: 'sync-line', dataset: { sync: '' } }, statusText()), h('div', { class: 'sync-line' }, 'version ' + APP_VERSION));
}

async function viewStory(sid, my) {
  const v = $('#view');
  fill(v, h('p', { class: 'empty' }, 'Chargement…'));
  const lib = await getLibrary();
  if (my !== routeSeq) return;
  const st = lib.stories.find((s) => s.id === sid);
  if (!st) { fill(v, h('p', { class: 'empty' }, 'Histoire introuvable. ', h('a', { href: '#/' }, 'Retour'))); return; }
  const list = [...(lib.chapters[sid] || [])].sort((a, b) => a.number - b.number);
  list.forEach((c) => fetch(c.file).catch(() => {}));   // garde les chapitres pour lire hors ligne
  fill(v, h('a', { href: '#/', class: 'back' }, '‹ Histoires'),
    h('h1', { class: 'page-title' }, st.title),
    h('p', { class: 'page-sub' }, st.synopsis || ''), refreshButton());

  const next = list.find((c) => chStatus(ckey(sid, c.id)) !== 'read');
  if (next) {
    const prog = chStatus(ckey(sid, next.id)) === 'prog';
    v.append(h('a', { class: 'hero', href: `#/read/${sid}/${next.id}` },
      h('div', { class: 'k' }, prog ? 'En cours' : 'Nouveau chapitre'),
      h('h2', null, `Chapitre ${next.number} · ${next.title}`),
      h('span', { class: 'go' }, prog ? 'Reprendre' : 'Commencer'), ' ',
      h('small', { style: 'color:#fff;opacity:.85' }, `${next.reading_minutes} min · ${next.cefr}`)));
  } else if (list.length) {
    v.append(h('div', { class: 'hero done' }, h('div', { class: 'k' }, 'À jour'),
      h('h2', null, 'Tu as tout lu.'), h('p', { style: 'margin:0 0 4px' }, 'La suite arrive bientôt. ', hint('you have read everything; more soon')),
      askNextBlock(ckey(sid, list[list.length - 1].id))));
  } else {
    v.append(h('p', { class: 'empty' }, 'Aucun chapitre pour le moment. ', hint('no chapters yet')));
  }
  const rows = list.map((c) => {
    const s = chStatus(ckey(sid, c.id));
    const badge = s === 'new' ? h('span', { class: 'badge new' }, 'Nouveau')
      : s === 'prog' ? h('span', { class: 'badge prog' }, 'En cours')
      : h('span', { class: 'badge read' }, 'Lu ✓');
    return h('a', { class: 'chrow', href: `#/read/${sid}/${c.id}` },
      h('div', { class: 'num' }, c.number),
      h('div', { class: 't' }, h('b', null, c.title), h('span', null, `${c.reading_minutes} min · ${c.cefr}`)),
      badge);
  });
  if (rows.length) v.append(h('div', { class: 'chlist' }, rows));
  v.append(h('div', { class: 'sync-line', dataset: { sync: '' } }, statusText()));
}

/* ---------- Texte : phrases, mots, mots cliquables ---------- */

// phrase qui contient la position `start` (ne coupe pas à l'intérieur de « »)
function sentenceAt(text, start) {
  const n = text.length;
  const bounds = [];
  let depth = 0;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === '«') depth++;
    else if (c === '»') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && /[.!?…]\s*$/.test(text.slice(0, i)) && (i + 1 >= n || /\s/.test(text[i + 1]))) bounds.push(i + 1);
    } else if (depth === 0 && '.!?…'.includes(c)) {
      let j = i;
      while (j + 1 < n && '.!?…"”)'.includes(text[j + 1])) j++;
      if (j + 1 >= n || /\s/.test(text[j + 1])) { bounds.push(j + 1); i = j; }
    } else if (c === '\n') bounds.push(i + 1);
  }
  bounds.push(n);
  const sorted = [...new Set(bounds)].sort((a, b) => a - b);
  let a = 0;
  for (const b of sorted) {
    if (start < b) {
      const raw = text.slice(a, b);
      const lead = raw.length - raw.trimStart().length;
      return { sentence: raw.trim(), offset: start - a - lead };
    }
    a = b;
  }
  return { sentence: text.trim(), offset: start };
}

function locate(text, x) {
  if (text.slice(x.start, x.end) === x.surface) return [x.start, x.end];
  let idx = -1, from = 0;
  for (let i = 0; i < (x.occurrence || 1); i++) {
    idx = text.indexOf(x.surface, from);
    if (idx < 0) return null;
    from = idx + 1;
  }
  return [idx, idx + x.surface.length];
}

function richText(seg, ch, sid, chid) {
  const frag = document.createDocumentFragment();
  const text = seg.text;
  const rs = [];
  for (const x of ch.highlights || []) if (x.segment_id === seg.id) { const p = locate(text, x); if (p) rs.push({ s: p[0], e: p[1], kind: 'hl', x }); }
  for (const x of ch.review_words || []) if (x.segment_id === seg.id) { const p = locate(text, x); if (p) rs.push({ s: p[0], e: p[1], kind: 'rv', x }); }
  rs.sort((a, b) => a.s - b.s);
  const addStr = (str) => str.split('\n').forEach((part, i) => {
    if (i) frag.append(document.createElement('br'));
    if (part) frag.append(part);
  });
  const addPlain = (from, to) => {                       // chaque mot du texte ordinaire devient cliquable
    const str = text.slice(from, to);
    const re = /quelqu['’]une?s?|aujourd['’]hui|presqu['’]île|[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/giu;   // l'économiste -> « économiste »
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m[0].length < 2) continue;
      addStr(str.slice(last, m.index));
      const span = h('span', { class: 'w', dataset: { s: from + m.index, e: from + m.index + m[0].length } }, m[0]);
      frag.append(span);
      last = m.index + m[0].length;
    }
    addStr(str.slice(last));
  };
  let pos = 0;
  for (const r of rs) {
    if (r.s < pos) continue;
    addPlain(pos, r.s);
    const span = document.createElement('span');
    span.textContent = text.slice(r.s, r.e);
    if (r.kind === 'hl') {
      const wid = `${sid}/${chid}/${r.x.id}`;
      span.className = 'hl' + (state.vocab.words[wid] ? ' saved' : '');
      span.dataset.wid = wid;
    } else {
      span.className = 'rv';
      span.dataset.ref = normId(r.x.dictionary_ref || '');
      span.dataset.lemma = r.x.lemma || '';
    }
    frag.append(span);
    pos = r.e;
  }
  addPlain(pos, text.length);
  return frag;
}

/* ---------- Lecture ---------- */

async function viewReader(sid, chid, my) {
  const v = $('#view');
  fill(v, h('p', { class: 'empty' }, 'Chargement…'));
  const lib = await getLibrary();
  if (my !== routeSeq) return;
  const entry = (lib.chapters[sid] || []).find((c) => c.id === chid);
  if (!entry) { fill(v, h('p', { class: 'empty' }, 'Chapitre introuvable. ', h('a', { href: '#/' }, 'Retour'))); return; }
  let ch;
  try { ch = await getChapter(entry); } catch (e) {
    fill(v, h('p', { class: 'empty' }, 'Impossible de charger ce chapitre (hors ligne ?). ', h('a', { href: '#/' }, 'Retour')));
    return;
  }
  if (my !== routeSeq) return;
  const key = ckey(sid, chid);

  const cast = ch.cast || {};
  const mainP = ch.segments[0].perspective;
  const col = (k) => (cast[k] && cast[k].color) || '#888888';
  const nm = (k) => (cast[k] && cast[k].name) || k || '';
  const segById = Object.fromEntries(ch.segments.map((s) => [s.id, s]));
  const ctxOf = (segId, start) => {
    const s = sentenceAt(segById[segId].text, start);
    return { segment_id: segId, sentence: s.sentence, form_start: s.offset };
  };
  const base = (extra) => Object.assign({ story: sid, chapter: ch.meta.number, chapter_id: chid, chapter_title: ch.meta.title }, extra);
  const wordMap = {};
  for (const x of ch.highlights || []) {
    wordMap[`${sid}/${chid}/${x.id}`] = base(Object.assign({ id: `${sid}/${chid}/${x.id}`, lemma: x.lemma, pos: x.pos, definition_fr: x.definition_fr,
      translation_en: x.translation_en, example: x.example, cefr: x.cefr, surface: x.surface }, ctxOf(x.segment_id, x.start)));
  }

  const stream = h('div', { class: 'stream' });
  let frame = null, frameP = null, chat = null, chatKey = null;
  for (const seg of ch.segments) {
    const isMain = seg.perspective === mainP;
    let parent = stream;
    if (!isMain) {
      if (seg.type === 'interlude' || !frame || frameP !== seg.perspective) {
        frame = h('div', { class: 'frame' }, h('div', { class: 'frame-head' },
          seg.type === 'interlude' ? seg.text : nm(seg.perspective).toUpperCase(), h('small', null, 'point de vue')));
        setColor(frame, col(seg.perspective));
        if (seg.type === 'interlude') frame.dataset.seg = seg.id;
        frameP = seg.perspective;
        stream.append(frame);
      }
      parent = frame;
    } else { frame = null; frameP = null; }
    if (seg.type === 'interlude') {
      if (isMain) { const d = h('div', { class: 'scene', dataset: { seg: seg.id } }, h('span', null, seg.text)); setColor(d, col(seg.perspective)); stream.append(d); }
      continue;
    }
    if (seg.type !== 'message') chat = null;
    const who = seg.speaker || seg.perspective;
    let node;
    switch (seg.type) {
      case 'scene':
        node = h('div', { class: 'scene' }, h('span', null, seg.text));
        break;
      case 'dialogue': {
        const me = who === mainP;
        node = h('div', { class: 'line' + (me ? ' me' : '') }, h('span', { class: 'who' }, nm(who)),
          h('div', { class: 'bub' }, richText(seg, ch, sid, chid)));
        setColor(node, col(who));
        break;
      }
      case 'thought': {
        const me = who === mainP;
        node = h('div', { class: 'line th' + (me ? ' me' : '') }, me ? null : h('span', { class: 'who' }, nm(who)),
          h('div', { class: 'thought' }, richText(seg, ch, sid, chid)));
        setColor(node, col(who));
        break;
      }
      case 'message': {
        const m = seg.message || {};
        const sender = m.sender || seg.speaker;
        const k = (m.chat || '') + '|' + seg.perspective;
        if (!chat || chatKey !== k || chat.parentNode !== parent) {
          chat = h('div', { class: 'chat' }, h('div', { class: 'chat-head' }, m.chat || 'Messages', h('small', null, 'messages')), h('div', { class: 'chat-body' }));
          chatKey = k;
          parent.append(chat);
        }
        const named = (m.chat || '') !== nm(sender);
        const bubble = h('div', { class: 'msg' + (sender === mainP ? ' out' : ''), dataset: { seg: seg.id } },
          named ? h('b', { style: 'font-size:12px;display:block' }, nm(sender)) : null,
          richText(seg, ch, sid, chid), h('time', null, m.time || ''));
        setColor(bubble, col(sender));
        $('.chat-body', chat).append(bubble);
        continue;
      }
      case 'document':
        node = h('div', { class: 'doc' }, richText(seg, ch, sid, chid));
        break;
      default: // narration et types inconnus
        node = h('p', { class: 'narr', style: 'margin:0' }, richText(seg, ch, sid, chid));
        setColor(node, col(seg.perspective));
    }
    node.dataset.seg = seg.id;
    parent.append(node);
  }

  const bar = h('i');
  const head = h('div', { class: 'rhead' },
    h('div', { class: 'row' }, h('a', { href: '#/story/' + sid }, '‹ Chapitres'),
      h('div', { class: 'ttl' }, `${ch.meta.number}. ${ch.meta.title}`), h('span', { class: 'sp' })),
    h('div', { class: 'bar' }, bar));
  const endBox = buildEnd(ch, sid, chid);
  const revBox = buildRevision(sid, ch.meta.number, key, () => {
    revBox.remove(); endBox.hidden = false; if (endBox.scrollIntoView) endBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  endBox.hidden = !!revBox;
  fill(v, head, stream, revBox, endBox);

  stream.addEventListener('click', (e) => {
    const t = e.target.closest('.hl, .rv, .w');
    if (!t) return;
    if (t.classList.contains('hl')) openCard(wordMap[t.dataset.wid]);
    else if (t.classList.contains('rv')) {
      const w = state.vocab.words[t.dataset.ref];
      if (w) openCard(w);
      else openCard({ id: t.dataset.ref, lemma: t.dataset.lemma, note: 'Mot de ton dictionnaire.', readonly: true });
    } else {
      const holder = t.closest('[data-seg]');
      if (!holder) return;
      const segId = holder.dataset.seg;
      const start = Number(t.dataset.s), end = Number(t.dataset.e);
      const form = segById[segId].text.slice(start, end);
      openCard(base(Object.assign({ id: `${sid}/${chid}/x-${segId}-${start}`, surface: form, arbitrary: true }, ctxOf(segId, start))));
    }
  });

  /* position de lecture */
  const segEls = [...v.querySelectorAll('[data-seg]')];
  const rec0 = getRec(key);
  let maxIdx = rec0.progress.last_segment_id ? segEls.findIndex((el) => el.dataset.seg === rec0.progress.last_segment_id) : -1;
  if (!rec0.progress.completed && maxIdx > 0) {
    requestAnimationFrame(() => window.scrollTo(0, segEls[maxIdx].getBoundingClientRect().top + window.scrollY - 90));
  }
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const total = document.documentElement.scrollHeight;
      bar.style.width = Math.min(100, ((window.scrollY + window.innerHeight) / total) * 100) + '%';
      let k = maxIdx;
      for (let i = Math.max(maxIdx, 0); i < segEls.length; i++) {
        if (segEls[i].getBoundingClientRect().top < window.innerHeight - 60) k = i; else break;
      }
      if (k > maxIdx && !getRec(key).progress.completed) {
        maxIdx = k;
        const r = touch(key);
        r.progress.last_segment_id = segEls[k].dataset.seg;
        saveState();
        scheduleSync(10000);
      }
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => window.removeEventListener('scroll', onScroll);
  onScroll();
}

function buildEnd(ch, sid, chid) {
  const key = ckey(sid, chid);
  const r0 = getRec(key);
  const form = { choice: r0.choice_id, diff: r0.feedback.difficulty, interest: r0.feedback.interest, comment: r0.feedback.comment || '' };
  const box = h('section', { class: 'end' });
  const lastSeg = ch.segments[ch.segments.length - 1].id;
  const render = () => {
    const done = !!getRec(key).submitted_at;
    const diffs = [['facile', 'Facile', 'easy'], ['ok', 'Normal', 'normal'], ['difficile', 'Difficile', 'hard']];
    fill(box,
      h('h2', null, 'Fin du chapitre'),
      h('h3', null, 'Que fais-tu ?', hint('what do you do?')),
      h('div', { class: 'opts' }, ch.choices.map((c) => h('button', { class: 'opt' + (form.choice === c.id ? ' on' : ''),
        onclick: () => { form.choice = c.id; render(); } }, c.text))),
      h('h3', null, 'Difficulté', hint('difficulty')),
      h('div', { class: 'seg' }, diffs.map(([val, lab, en]) => h('button', { class: form.diff === val ? 'on' : '',
        onclick: () => { form.diff = val; render(); } }, lab, h('small', null, en)))),
      h('h3', null, 'Intérêt', hint('1 = bof (meh), 5 = j\'adore (love it)')),
      h('div', { class: 'seg' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: form.interest === n ? 'on' : '',
        onclick: () => { form.interest = n; render(); } }, String(n)))),
      h('h3', null, 'Commentaire', hint('optional')),
      h('textarea', { placeholder: 'Un mot sur ce chapitre (facultatif)', oninput: (e) => { form.comment = e.target.value; } }, form.comment),
      h('button', { class: 'btn', disabled: !(form.choice && form.diff && form.interest), onclick: () => {
        const r = touch(key);
        r.choice_id = form.choice;
        r.feedback = { difficulty: form.diff, interest: form.interest, comment: form.comment.trim() || null };
        r.progress = { last_segment_id: lastSeg, completed: true };
        r.submitted_at = nowISO();
        saveState();
        scheduleSync(600);
        render();
      } }, done ? 'Mettre à jour' : 'Valider mon choix', hintIn(done ? 'update' : 'confirm')),
      done ? h('p', { class: 'saved-note' }, '✓ Enregistré. ', h('span', { 'data-sync': '', style: 'font-weight:400;color:var(--muted)' }, statusText())) : null,
      done ? askNextBlock(key) : null,
      done ? h('a', { class: 'btn ghost', href: '#/story/' + sid, style: 'text-align:center;text-decoration:none' }, 'Retour aux chapitres') : null
    );
  };
  render();
  const hook = () => { if (getRec(key).submitted_at) render(); };
  syncHooks.add(hook);
  endHookCleanup = () => syncHooks.delete(hook);
  return box;
}

/* ---------- Répétition espacée (srs) ---------- */

const LEVELS = ['Nouveau', 'Fragile', 'En cours', 'Solide', 'Presque', 'Maîtrisé'];
const dots = (l) => '●'.repeat(l) + '○'.repeat(5 - l);
const isPending = (w) => w.card_status === 'pending';
// niveau 0-5 calculé depuis srs (jamais stocké) ; null pour un mot "en attente"
function levelOf(w) {
  if (isPending(w)) return null;
  const s = w.srs;
  if (s.status === 'mastered' || s.interval >= 30) return 5;
  if (s.reps === 0) return 0;
  const last = s.history[s.history.length - 1];
  if (last && last.grade === 'again') return 1;
  if (s.interval <= 2) return 1;
  if (s.interval <= 7) return 2;
  if (s.interval <= 19) return 3;
  return 4;
}
function candidates(P) {
  return Object.values(state.vocab.words)
    .filter((w) => !isPending(w) && w.srs.status !== 'mastered' && w.srs.due_at <= P)
    .sort((a, b) => a.srs.due_at - b.srs.due_at || b.srs.lapses - a.srs.lapses || (a.added_at < b.added_at ? -1 : 1));
}
function gradeWord(id, grade, sid, chNum) {
  const w = state.vocab.words[id];
  if (!w) return;
  const s = w.srs, P = computeP(), I0 = s.interval;
  let I;
  if (grade === 'again') { I = 1; s.lapses += 1; }
  else if (grade === 'hard') I = I0 === 0 ? 1 : Math.max(I0 + 1, Math.round(I0 * 1.2));
  else if (grade === 'good') I = I0 === 0 ? 2 : Math.round(I0 * 2.5);
  else I = I0 === 0 ? 4 : Math.round(I0 * 3.5);
  s.interval = I;
  s.reps += 1;
  s.due_at = P + I;
  s.history.push({ story: sid, chapter: chNum, grade, at: nowISO() });
  s.status = 'learning';
  if ((grade === 'good' || grade === 'easy') && I >= 30) s.status = 'mastered';
  saveState();
  scheduleSync(1500);
}
function reviewAgain(id) {                               // « Revoir encore » : mot appris -> à nouveau en cours
  const w = state.vocab.words[id];
  if (!w) return;
  const s = w.srs;
  s.status = 'learning'; s.interval = 1; s.due_at = computeP() + 1;
  s.history.push({ story: w.story, chapter: Number(w.chapter) || 0, grade: 'reset', at: nowISO() });
  saveState(); scheduleSync(1500);
}

function emphasised(w) {                                  // phrase du texte avec le mot en évidence
  const el = h('p', { class: 'rsent' });
  const sent = w.sentence, f = w.surface || w.lemma || '';
  if (sent && Number.isInteger(w.form_start) && sent.slice(w.form_start, w.form_start + f.length) === f) {
    el.append(sent.slice(0, w.form_start), h('mark', null, f), sent.slice(w.form_start + f.length));
  } else if (sent && sent.includes(f)) {
    const i = sent.indexOf(f);
    el.append(sent.slice(0, i), h('mark', null, f), sent.slice(i + f.length));
  } else el.append(sent || '', sent ? '' : h('mark', null, f));
  return el;
}

// écran « Révision » : seulement à la première lecture du chapitre, avant le choix
function buildRevision(sid, chNum, key, onDone) {
  if (getRec(key).progress.completed) return null;
  let sess = state.revision[key];
  if (!sess) {
    const ids = candidates(computeP()).slice(0, 5).map((w) => w.id);
    if (!ids.length) return null;
    sess = state.revision[key] = { ids, done: [], skipped: false };   // fixé localement pour cette session
    saveState();
  }
  if (sess.skipped) return null;
  const queue = sess.ids.filter((id) => !sess.done.includes(id) && state.vocab.words[id] && !isPending(state.vocab.words[id]));
  if (!queue.length) return null;
  const total = sess.ids.length;
  const box = h('section', { class: 'revision' });
  let flipped = false;
  const render = () => {
    const id = queue[0];
    const w = state.vocab.words[id];
    const finished = () => { saveState(); onDone(); };
    const head = h('div', { class: 'rev-head' }, h('h2', null, 'Révision ', hint('review')),
      h('span', { class: 'rev-count' }, `${total - queue.length + 1}/${total}`),
      h('button', { class: 'rev-skip', onclick: () => { sess.skipped = true; finished(); } }, 'Passer', hintIn('skip')));
    if (!flipped) {
      fill(box, head, h('div', { class: 'rcard', onclick: () => { flipped = true; render(); } },
        emphasised(w), h('p', { class: 'rtap' }, 'Touche pour voir la réponse ', hint('tap to reveal'))));
    } else {
      const g = (grade, label, en) => h('button', { class: 'grade ' + grade, onclick: () => {
        gradeWord(id, grade, sid, chNum);
        sess.done.push(id); queue.shift(); flipped = false;
        if (!queue.length) { finished(); return; }
        saveState(); render();
      } }, label, h('small', null, en));
      fill(box, head, h('div', { class: 'rcard back' },
        emphasised(w),
        h('div', { class: 'card-lemma' }, w.lemma || w.surface),
        h('div', { class: 'card-pos' }, [w.pos, w.cefr].filter(Boolean).join(' · ')),
        w.definition_fr ? [h('div', { class: 'card-lab' }, 'Définition'), h('div', { class: 'card-val' }, w.definition_fr)] : null,
        w.translation_en ? [h('div', { class: 'card-lab' }, 'English'), h('div', { class: 'card-val' }, w.translation_en)] : null),
      h('div', { class: 'grades' }, g('again', 'À revoir', 'again'), g('hard', 'Difficile', 'hard'), g('good', 'Bien', 'good'), g('easy', 'Facile', 'easy')));
    }
  };
  render();
  return box;
}

/* ---------- Fiche d'un mot ---------- */

let sheetToken = 0;
function closeSheet() { sheetToken++; $('#sheet').hidden = true; $('#backdrop').hidden = true; }
function refreshHighlights() {
  document.querySelectorAll('.hl').forEach((e) => e.classList.toggle('saved', !!state.vocab.words[e.dataset.wid]));
}
const normForm = (s) => (s || '').toLowerCase();
function findByForm(form) {
  const f = normForm(form);
  return Object.values(state.vocab.words).find((w) => normForm(w.surface) === f);
}
const wikt = {};
async function fetchWiktionary(word) {
  const k = normForm(word);
  if (k in wikt) return wikt[k];
  let out = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(k), { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      const items = [];
      for (const sec of j.fr || []) {
        for (const d of sec.definitions || []) {
          const txt = new DOMParser().parseFromString('<div>' + (d.definition || '') + '</div>', 'text/html').body.textContent.trim();
          if (txt) items.push((sec.partOfSpeech ? sec.partOfSpeech.toLowerCase() + ': ' : '') + (txt.length > 140 ? txt.slice(0, 137) + '…' : txt));
          if (items.length >= 3) break;
        }
        if (items.length >= 3) break;
      }
      out = items.length ? items : null;
    }
  } catch (e) { out = null; }
  wikt[k] = out;
  return out;
}
const wordRefLink = (word) => h('a', { class: 'btn ghost', href: 'https://www.wordreference.com/fren/' + encodeURIComponent(word),
  target: '_blank', rel: 'noopener', style: 'text-align:center;text-decoration:none' }, 'WordReference', hintIn('fr → en'));

function openCard(w) {
  if (!w) return;
  const sheet = $('#sheet');
  const token = ++sheetToken;
  const saved = state.vocab.words[w.id] || (w.arbitrary ? findByForm(w.surface) : null);
  const full = saved || w;
  const pending = !!saved && isPending(saved);
  const lab = (t) => h('div', { class: 'card-lab' }, t);
  const title = full.lemma || full.surface;
  const where = full.chapter_title ? `${storyTitle(full.story)} · chapitre ${full.chapter} · ${full.chapter_title}` : '';
  const wiktBox = h('div', { class: 'wikt', hidden: true });
  const lvl = saved ? levelOf(saved) : null;

  const actions = [];
  if (w.readonly) { /* pas d'action */ }
  else if (saved) {
    actions.push(h('div', { class: 'saved-note' }, '✓ Dans ton dictionnaire'));
    if (!pending && saved.srs.status === 'mastered') {
      actions.push(h('button', { class: 'btn ghost', onclick: () => { reviewAgain(saved.id); openCard(saved); afterWordChange(); } }, 'Revoir encore', hintIn('review again')));
    }
    actions.push(h('button', { class: 'btn danger', onclick: () => {
      if (!confirm('Retirer ce mot du dictionnaire ?')) return;
      removeWord(saved.id); closeSheet(); afterWordChange();
    } }, 'Retirer du dictionnaire'));
  } else {
    actions.push(h('button', { class: 'btn', onclick: () => { addWord(w); afterWordChange(); openCard(w); } },
      w.arbitrary ? 'Ajouter' : 'Ajouter au dictionnaire', hintIn('add to dictionary')));
  }

  fill(sheet,
    h('div', { class: 'grab' }),
    h('div', { class: 'card-lemma' }, title),
    h('div', { class: 'card-pos' }, pending ? 'en attente de la carte complète ' : [full.pos, full.cefr].filter(Boolean).join(' · '),
      pending ? hint('waiting for details') : null),
    full.sentence ? [lab('Dans le texte'), emphasised(full)] : null,
    full.definition_fr ? [lab('Définition'), h('div', { class: 'card-val' }, full.definition_fr)] : null,
    full.translation_en ? [lab('English'), h('div', { class: 'card-val' }, full.translation_en)] : null,
    full.example ? [lab('Exemple'), h('div', { class: 'card-val ex' }, full.example)] : null,
    w.arbitrary || pending ? wiktBox : null,
    full.note ? h('p', { class: 'card-val' }, full.note) : null,
    where ? h('div', { class: 'card-src' }, where) : null,
    saved && !pending ? h('div', { class: 'card-src' }, `Niveau : ${dots(lvl)} ${LEVELS[lvl]} · prochaine révision : chapitre ${saved.srs.due_at}`) : null,
    actions,
    w.arbitrary || pending ? wordRefLink(full.surface || title) : null,
    h('button', { class: 'btn ghost', onclick: closeSheet }, 'Fermer')
  );
  sheet.hidden = false;
  $('#backdrop').hidden = false;
  sheet.scrollTop = 0;

  if ((w.arbitrary || pending) && !w.readonly) {                    // valeur courte via Wiktionary ; en cas d'échec, on n'affiche rien
    fetchWiktionary(full.surface || title).then((items) => {
      if (!items || token !== sheetToken) return;
      fill(wiktBox, h('div', { class: 'card-lab' }, 'Wiktionary'), items.map((t) => h('div', { class: 'card-val small' }, t)));
      wiktBox.hidden = false;
    });
  }
}
function addWord(w) {
  const key = ckey(w.story, w.chapter_id);
  ensureRec(key);
  delete state.vocab.deleted[w.id];
  const rec = Object.assign({}, w, { added_at: nowISO(), srs: blankSrs(computeP() + 1) });
  delete rec.arbitrary; delete rec.readonly;
  if (w.arbitrary) rec.card_status = 'pending';
  state.vocab.words[w.id] = normWord(rec, state);
  saveState(); scheduleSync(1500);
}
function removeWord(id) {
  delete state.vocab.words[id];
  state.vocab.deleted[id] = nowISO();
  saveState(); scheduleSync(1500);
}
function afterWordChange() {
  refreshHighlights();
  if ((location.hash || '').startsWith('#/words')) viewWords();
}

/* ---------- Dictionnaire ---------- */

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let wordQuery = '';
function viewWords() {
  const v = $('#view');
  const all = Object.values(state.vocab.words);
  const ui = state.ui;
  const sort = ui.sort || 'level';
  const filter = ui.filter || 'all';
  const counts = [0, 0, 0, 0, 0, 0];
  let nPending = 0;
  all.forEach((w) => { const l = levelOf(w); if (l == null) nPending++; else counts[l]++; });
  const listBox = h('div');
  const renderList = () => {
    const hide = !!ui.hideTr;
    const q = norm(wordQuery);
    let shown = all.filter((w) => {
      const l = levelOf(w);
      if (filter === 'pending' && l != null) return false;
      if (/^\d$/.test(filter) && l !== Number(filter)) return false;
      return !q || norm([w.lemma, w.surface, w.translation_en, w.definition_fr].join(' ')).includes(q);
    });
    const name = (w) => norm(w.lemma || w.surface);
    shown = shown.sort((a, b) => {
      if (sort === 'date') return a.added_at < b.added_at ? 1 : -1;
      if (sort === 'alpha') return name(a) < name(b) ? -1 : 1;
      const la = levelOf(a), lb = levelOf(b);                          // du plus faible au plus fort ; "en attente" à la fin
      return (la == null ? 9 : la) - (lb == null ? 9 : lb) || (a.added_at < b.added_at ? -1 : 1);
    });
    listBox.replaceChildren(...(shown.length
      ? [h('div', { class: 'wlist' }, shown.map((w) => {
          const l = levelOf(w);
          return h('button', { class: 'wrow', onclick: () => openCard(w) },
            h('b', null, w.lemma || w.surface), ' ',
            w.cefr ? h('span', { class: 'cefr' }, w.cefr) : null, ' ',
            h('span', { class: 'tr' + (hide ? ' blur' : '') }, w.translation_en || ''),
            h('div', { class: 'lvl' }, l == null ? h('span', { class: 'pend' }, 'en attente ', hint('waiting for details')) : [h('span', { class: 'dots' }, dots(l)), ' ' + LEVELS[l]]),
            h('div', { class: 'meta' }, `${storyTitle(w.story)} · chapitre ${w.chapter}`));
        }))]
      : [h('p', { class: 'empty' }, all.length ? 'Aucun résultat.' : 'Aucun mot pour l\'instant. Touche un mot pendant la lecture.',
          h('br'), hint(all.length ? 'no results' : 'no words yet: tap a word while reading'))]));
  };
  const chip = (key, label, n) => h('button', { class: 'chip' + (filter === key ? ' on' : ''), onclick: () => {
    ui.filter = filter === key ? 'all' : key; saveState(); viewWords();
  } }, label, h('b', null, String(n)));
  const sel = (opts, cur, onchange) => h('select', { onchange: (e) => onchange(e.target.value) },
    opts.map(([val, lab]) => h('option', { value: val, selected: val === cur ? 'selected' : null }, lab)));
  fill(v,
    h('h1', { class: 'page-title' }, 'Dictionnaire'),
    h('p', { class: 'page-sub' }, `${all.length} mot${all.length > 1 ? 's' : ''} `, hint(`${all.length} saved word${all.length === 1 ? '' : 's'}`)),
    h('div', { class: 'chips' }, LEVELS.map((n, i) => chip(String(i), `${i} ${n}`, counts[i])), nPending ? chip('pending', 'en attente', nPending) : null),
    h('div', { class: 'tools' },
      h('input', { type: 'search', placeholder: 'Chercher…', value: wordQuery, oninput: (e) => { wordQuery = e.target.value; renderList(); } })),
    h('div', { class: 'tools' },
      sel([['level', 'Niveau (le plus faible d\'abord)'], ['date', 'Date d\'ajout'], ['alpha', 'Alphabétique']], sort, (val) => { ui.sort = val; saveState(); viewWords(); }),
      h('label', null, h('input', { type: 'checkbox', checked: ui.hideTr ? 'checked' : null,
        onchange: (e) => { ui.hideTr = e.target.checked; saveState(); renderList(); } }),
      h('span', null, 'Cacher la traduction', h('br'), hint('hide translation')))),
    listBox
  );
  renderList();
}

/* ---------- Réglages ---------- */

function applySelectMode() { document.body.classList.toggle('sel', !!state.ui.selectText); }

function viewSettings() {
  const v = $('#view');
  const hasToken = !!getToken();
  const standalone = window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const input = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const msg = h('p', { class: 'st' });
  const note = settingsNote; settingsNote = '';
  const chatMsg = h('p', { class: 'st' });
  const chatInput = h('input', { type: 'text', inputmode: 'url', placeholder: 'https://claude.ai/chat/…', value: getChatUrl(), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  fill(v,
    h('h1', { class: 'page-title' }, 'Réglages'), h('p', { class: 'page-sub' }, hint('settings')),
    h('div', { class: 'panel' }, h('h2', null, 'Synchronisation ', hint('sync')),
      h('p', { class: 'st', dataset: { sync: '' } }, statusText()),
      h('button', { class: 'btn ghost', onclick: () => syncNow() }, 'Synchroniser maintenant')),
    h('div', { class: 'panel' }, h('h2', null, 'Sélection du texte ', hint('text selection')),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: state.ui.selectText ? 'checked' : null,
        onchange: (e) => { state.ui.selectText = e.target.checked; saveState(); applySelectMode(); } }),
        h('span', null, 'Activer la sélection du texte')),
      h('p', null, hint('Off: a long press does nothing, a tap on a word opens its card. On: a long press selects text like normal iPhone text (Look Up, Translate, Copy); a tap still opens the card.'))),
    h('div', { class: 'panel' }, h('h2', null, 'Jeton GitHub ', hint('GitHub token')),
      h('p', null, hasToken ? 'Un jeton est enregistré sur ce téléphone. ✓' : 'Colle ici ton jeton (une seule fois).'),
      h('p', null, hint('The token stays only on this phone. It lets the app save your choices, feedback and words to your repository.')),
      input,
      h('button', { class: 'btn', onclick: async () => {
        const t = input.value.trim();
        if (!t) { msg.className = 'st err'; msg.textContent = 'Colle d\'abord le jeton.'; return; }
        msg.className = 'st wait'; msg.textContent = 'Vérification…';
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`, { headers: ghHeaders(t), cache: 'no-store' });
          if (!r.ok) throw new Error(r.status);
          localStorage.setItem(LS_TOKEN, t);
          input.value = '';
          msg.className = 'st ok'; msg.textContent = 'Jeton accepté ✓';
          syncNow();
        } catch (e) {
          msg.className = 'st err'; msg.textContent = 'Jeton refusé. Vérifie qu\'il est copié en entier et qu\'il donne accès à ce dépôt.';
        }
      } }, 'Enregistrer le jeton'),
      hasToken ? h('button', { class: 'btn danger', style: 'margin-top:10px', onclick: () => {
        if (confirm('Effacer le jeton de ce téléphone ?')) { localStorage.removeItem(LS_TOKEN); setStatus('local'); viewSettings(); }
      } }, 'Effacer le jeton') : null,
      msg),
    h('div', { class: 'panel' + (note ? ' flash' : '') }, h('h2', null, 'Lien du chat Claude ', hint('link to your Claude chat')),
      note ? h('p', { class: 'st wait' }, note) : null,
      note ? h('p', null, hint('Paste the link of your Claude generation chat here (open the chat, copy the address from the browser), then come back and tap the button.')) : null,
      h('p', null, 'Colle ici l\'adresse de ton chat de génération. Le bouton « Demander la suite » l\'ouvrira. ',
        hint('Stays only on this phone, never sent to the repository.')),
      chatInput,
      h('button', { class: 'btn', onclick: () => {
        const u = chatInput.value.trim();
        if (u && !/^https:\/\/\S+$/.test(u)) { chatMsg.className = 'st err'; chatMsg.textContent = 'Le lien doit commencer par https://'; return; }
        try { if (u) localStorage.setItem(LS_CHAT, u); else localStorage.removeItem(LS_CHAT); } catch (e) { /* ignore */ }
        chatMsg.className = 'st ok'; chatMsg.textContent = u ? 'Lien enregistré ✓' : 'Lien effacé';
      } }, 'Enregistrer le lien'),
      chatMsg),
    standalone ? null : h('div', { class: 'panel' }, h('h2', null, 'Installer l\'appli ', hint('install the app')),
      h('p', null, 'Dans Safari : touche le bouton Partager, puis « Sur l\'écran d\'accueil ». ',
        hint('In Safari: tap Share, then Add to Home Screen.')),
      h('p', null, 'Ouvre ensuite l\'appli depuis l\'écran d\'accueil et colle le jeton là, pas dans Safari. ',
        hint('Open the installed app and paste the token there, not in Safari.'))),
    h('p', { class: 'sync-line' }, `Équilibre instable · version ${APP_VERSION}`)
  );
}

/* ---------- Démarrage ---------- */

$('#backdrop').addEventListener('click', closeSheet);
window.addEventListener('hashchange', route);
window.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (syncTimer) syncNow(); }
  else setTimeout(syncNow, 400);
});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

applySelectMode();
saveState();
route();
syncNow();
