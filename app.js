'use strict';
/* Équilibre instable : lecteur d'histoire (PWA). Aucun framework, aucun build. */

const APP_VERSION = '1.1.0';
const REPO = { owner: 'khvdovychenko', repo: 'equilibre-instable', branch: 'main' };
const LS_STATE = 'equilibre_state_v1';
const LS_TOKEN = 'equilibre_token';
const LS_INDEX = 'equilibre_index';
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
  for (const k of kids.flat()) {
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

/* ---------- État local (persistant) ---------- */

const blankRec = () => ({
  choice_id: null,
  feedback: { difficulty: null, interest: null, comment: null },
  saved_words: [],
  progress: { last_segment_id: null, completed: false },
  submitted_at: null,
  updated_at: null,
});

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_STATE));
    if (s && s.v === 1) {
      s.chapters = s.chapters || {};
      s.vocab = s.vocab || { words: {}, deleted: {} };
      s.vocab.words = s.vocab.words || {};
      s.vocab.deleted = s.vocab.deleted || {};
      s.ui = s.ui || {};
      s.synced = s.synced || {};
      return s;
    }
  } catch (e) { /* état vide */ }
  return { v: 1, chapters: {}, vocab: { words: {}, deleted: {} }, ui: {}, synced: {}, last_sync: null };
}
let state = loadState();
function saveState() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { /* stockage plein */ }
}
const getChatUrl = () => { try { return localStorage.getItem(LS_CHAT) || ''; } catch (e) { return ''; } };
const getToken = () => { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } };

const getRec = (id) => state.chapters[id] || blankRec();
function ensureRec(id) { return (state.chapters[id] = state.chapters[id] || blankRec()); }
function touch(id) { const r = ensureRec(id); r.updated_at = nowISO(); return r; }

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
    return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
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
function chapterFile(id) {
  const r = getRec(id);
  const saved = Object.values(state.vocab.words).filter((w) => w.chapter_id === id).map((w) => w.id.split('@')[0]).sort();
  return {
    choice_id: r.choice_id,
    feedback: { difficulty: r.feedback.difficulty, interest: r.feedback.interest, comment: r.feedback.comment },
    saved_words: saved,
    progress: { last_segment_id: r.progress.last_segment_id, completed: !!r.progress.completed },
    submitted_at: r.submitted_at,
    updated_at: r.updated_at,
  };
}
async function syncChapter(id, token) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await remoteRead(`reader/${id}.json`, token);
    if (remote && remote.data && ts(remote.data) > ts(state.chapters[id])) {
      const d = remote.data;
      state.chapters[id] = Object.assign(blankRec(), d, {
        feedback: Object.assign(blankRec().feedback, d.feedback || {}),
        progress: Object.assign(blankRec().progress, d.progress || {}),
      });
    }
    if (!token || !state.chapters[id]) return;
    const mine = chapterFile(id);
    if (remote && JSON.stringify(mine) === JSON.stringify(remote.data)) { state.synced[id] = mine.updated_at || 'x'; return; }
    const res = await remoteWrite(`reader/${id}.json`, mine, remote && remote.sha, `reader: ${id}`, token);
    if (res === 'ok') { state.synced[id] = mine.updated_at || 'x'; return; }
  }
  throw new Error('conflit');
}

/* dictionnaire : par mot, le plus récent (ajout ou suppression) gagne */
function mergeVocab(remote) {
  const L = state.vocab;
  const rw = Object.fromEntries((remote.words || []).map((w) => [w.id, w]));
  const rd = Object.fromEntries((remote.deleted || []).map((d) => [d.id, d.deleted_at]));
  const ids = new Set([...Object.keys(L.words), ...Object.keys(L.deleted), ...Object.keys(rw), ...Object.keys(rd)]);
  for (const id of ids) {
    const c = [];
    if (L.words[id]) c.push({ t: Date.parse(L.words[id].added_at), w: L.words[id] });
    if (rw[id]) c.push({ t: Date.parse(rw[id].added_at), w: rw[id] });
    if (L.deleted[id]) c.push({ t: Date.parse(L.deleted[id]), del: L.deleted[id] });
    if (rd[id]) c.push({ t: Date.parse(rd[id]), del: rd[id] });
    c.sort((a, b) => b.t - a.t || (a.del ? 0 : 1) - (b.del ? 0 : 1));
    const win = c[0];
    if (win.del) { delete L.words[id]; L.deleted[id] = win.del; } else { L.words[id] = win.w; delete L.deleted[id]; }
  }
}
function vocabFile() {
  const words = Object.values(state.vocab.words).sort((a, b) => (a.added_at < b.added_at ? -1 : 1));
  const deleted = Object.entries(state.vocab.deleted).map(([id, deleted_at]) => ({ id, deleted_at })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const stamps = [...words.map((w) => w.added_at), ...deleted.map((d) => d.deleted_at)].sort();
  return { schema_version: '1.0', updated_at: stamps.length ? stamps[stamps.length - 1] : null, words, deleted };
}
async function syncVocab(token) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await remoteRead('reader/vocabulary.json', token);
    if (remote && remote.data) mergeVocab(remote.data);
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
  const before = JSON.stringify([state.chapters, state.vocab]) + localStorage.getItem(LS_INDEX);
  setStatus('sync');
  try {
    const idx = await getIndex();
    const ids = [...new Set([...idx.chapters.map((c) => c.id), ...Object.keys(state.chapters)])];
    await syncVocab(token);
    for (const id of ids) await syncChapter(id, token);
    state.last_sync = nowISO();
    saveState();
    setStatus(token ? 'ok' : 'local');
  } catch (e) {
    saveState();
    setStatus(navigator.onLine ? 'err' : 'offline', navigator.onLine ? e.message : '');
  } finally {
    syncing = false;
    const after = JSON.stringify([state.chapters, state.vocab]) + localStorage.getItem(LS_INDEX);
    if (after !== before && !document.body.classList.contains('reading') && $('#sheet').hidden) route();
    syncHooks.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
}

/* ---------- Données de l'histoire ---------- */

async function getIndex() {
  try {
    const r = await fetch('chapters/index.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      try { localStorage.setItem(LS_INDEX, JSON.stringify(j)); } catch (e) { /* ignore */ }
      return j;
    }
  } catch (e) { /* hors ligne */ }
  try { const c = JSON.parse(localStorage.getItem(LS_INDEX)); if (c && c.chapters) return c; } catch (e) { /* ignore */ }
  return { chapters: [] };
}
const chapterCache = {};
async function getChapter(entry) {
  if (chapterCache[entry.id]) return chapterCache[entry.id];
  const r = await fetch(entry.file);
  if (!r.ok) throw new Error('chapitre ' + r.status);
  return (chapterCache[entry.id] = await r.json());
}
const chStatus = (id) => {
  const r = getRec(id);
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
    (a.dataset.tab === 'library' && (name === '' || name === 'read')) || a.dataset.tab === name));
  const showErr = (e) => fill($('#view'), h('p', { class: 'empty' }, 'Erreur dans l\'appli : ' + (e && e.message ? e.message : e),
    h('br'), hint('please send this message to Claude')));
  try {
    let p;
    if (name === 'read') p = viewReader(parts[2], my);
    else if (name === 'words') viewWords();
    else if (name === 'settings') viewSettings();
    else p = viewLibrary(my);
    if (p && p.catch) p.catch(showErr);
  } catch (e) { showErr(e); }
  if (name !== 'read') window.scrollTo(0, 0);
}

/* ---------- Bouton « Demander la suite » ---------- */

let settingsNote = '';
const isSynced = (id) => {
  const r = state.chapters[id];
  return !!(r && r.progress.completed && getToken() && state.synced[id] === (r.updated_at || 'x'));
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
  // copie et ouverture dans le même geste (sinon iOS bloque l'ouverture)
  const p = copyText(NEXT_TEXT);
  try { window.open(url, '_blank'); } catch (e) { location.href = url; }
  p.then(() => { msgEl.textContent = '« ' + NEXT_TEXT + ' » est copié. Colle-le dans le chat.'; })
   .catch(() => { msgEl.textContent = 'Copie impossible : напиши: ' + NEXT_TEXT; });
}
// bouton si le dernier chapitre est confirmé ET synchronisé, sinon une note d'attente
function askNextBlock(chId) {
  const msg = h('p', { class: 'ask-msg' });
  if (!isSynced(chId)) {
    return h('div', { class: 'ask' }, h('p', { class: 'ask-wait' },
      getToken() ? 'Le bouton « Demander la suite » apparaît dès que ton choix est synchronisé.' : 'Ajoute le jeton dans « Réglages » : le bouton « Demander la suite » apparaîtra après la synchronisation.',
      h('br'), hint('the "ask for the next chapter" button appears once your choice is synced')));
  }
  return h('div', { class: 'ask' },
    h('button', { class: 'btn', onclick: () => askNext(msg) }, 'Demander la suite', hintIn('ask for the next chapter')),
    msg);
}

/* ---------- Bibliothèque ---------- */

async function viewLibrary(my) {
  const v = $('#view');
  fill(v, h('h1', { class: 'page-title' }, 'Équilibre instable'),
    h('p', { class: 'page-sub' }, 'Une histoire pour lire en français. ', hint('a story to read in French')));
  const idx = await getIndex();
  if (my !== routeSeq) return;
  const list = [...idx.chapters].sort((a, b) => a.number - b.number);
    const refreshBtn = h('button', { class: 'btn ghost', style: 'margin:0 0 16px', onclick: async () => {
    refreshBtn.disabled = true; refreshBtn.firstChild.textContent = 'Actualisation…';
    try { await syncNow(); } catch (e) { /* le statut montre l'erreur */ }
    route();
  } }, 'Actualiser', hintIn('refresh: fetch the new chapter'));
  v.append(refreshBtn);
  idx.chapters.forEach((c) => fetch(c.file).catch(() => {})); // garde les chapitres pour lire hors ligne

  const next = list.find((c) => chStatus(c.id) !== 'read');
  if (next) {
    const prog = chStatus(next.id) === 'prog';
    v.append(h('a', { class: 'hero', href: '#/read/' + next.id },
      h('div', { class: 'k' }, prog ? 'En cours' : 'Nouveau chapitre'),
      h('h2', null, `Chapitre ${next.number} · ${next.title}`),
      h('span', { class: 'go' }, prog ? 'Reprendre' : 'Commencer'), ' ',
      h('small', { style: 'color:#fff;opacity:.85' }, `${next.reading_minutes} min · ${next.cefr}`)));
  } else if (list.length) {
    v.append(h('div', { class: 'hero done' }, h('div', { class: 'k' }, 'À jour'),
      h('h2', null, 'Tu as tout lu.'), h('p', { style: 'margin:0 0 4px' }, 'La suite arrive bientôt. ', hint('you have read everything; more soon')),
      askNextBlock(list[list.length - 1].id)));
  } else {
    v.append(h('p', { class: 'empty' }, 'Aucun chapitre pour le moment. ', hint('no chapters yet')));
  }

  const rows = list.map((c) => {
    const s = chStatus(c.id);
    const badge = s === 'new' ? h('span', { class: 'badge new' }, 'Nouveau')
      : s === 'prog' ? h('span', { class: 'badge prog' }, 'En cours')
      : h('span', { class: 'badge read' }, 'Lu ✓');
    return h('a', { class: 'chrow', href: '#/read/' + c.id },
      h('div', { class: 'num' }, c.number),
      h('div', { class: 't' }, h('b', null, c.title), h('span', null, `${c.reading_minutes} min · ${c.cefr}`)),
      badge);
  });
  if (rows.length) v.append(h('div', { class: 'chlist' }, rows));
  v.append(h('div', { class: 'sync-line', dataset: { sync: '' } }, statusText()), h('div', { class: 'sync-line' }, 'version ' + APP_VERSION));
}

/* ---------- Lecture ---------- */

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

function richText(seg, ch, chId) {
  const frag = document.createDocumentFragment();
  const text = seg.text;
  const rs = [];
  for (const x of ch.highlights || []) if (x.segment_id === seg.id) { const p = locate(text, x); if (p) rs.push({ s: p[0], e: p[1], kind: 'hl', x }); }
  for (const x of ch.review_words || []) if (x.segment_id === seg.id) { const p = locate(text, x); if (p) rs.push({ s: p[0], e: p[1], kind: 'rv', x }); }
  rs.sort((a, b) => a.s - b.s);
  const add = (str) => str.split('\n').forEach((part, i) => {
    if (i) frag.append(document.createElement('br'));
    if (part) frag.append(part);
  });
  let pos = 0;
  for (const r of rs) {
    if (r.s < pos) continue;
    add(text.slice(pos, r.s));
    const span = document.createElement('span');
    span.textContent = text.slice(r.s, r.e);
    if (r.kind === 'hl') {
      const wid = `${r.x.id}@${chId}`;
      span.className = 'hl' + (state.vocab.words[wid] ? ' saved' : '');
      span.dataset.wid = wid;
    } else {
      span.className = 'rv';
      span.dataset.ref = r.x.dictionary_ref || '';
      span.dataset.lemma = r.x.lemma || '';
    }
    frag.append(span);
    pos = r.e;
  }
  add(text.slice(pos));
  return frag;
}

async function viewReader(id, my) {
  const v = $('#view');
  fill(v, h('p', { class: 'empty' }, 'Chargement…'));
  const idx = await getIndex();
  if (my !== routeSeq) return;
  const entry = idx.chapters.find((c) => c.id === id);
  if (!entry) { fill(v, h('p', { class: 'empty' }, 'Chapitre introuvable. ', h('a', { href: '#/' }, 'Retour'))); return; }
  let ch;
  try { ch = await getChapter(entry); } catch (e) {
    fill(v, h('p', { class: 'empty' }, 'Impossible de charger ce chapitre (hors ligne ?). ', h('a', { href: '#/' }, 'Retour')));
    return;
  }
  if (my !== routeSeq) return;

  const cast = ch.cast || {};
  const mainP = ch.segments[0].perspective;
  const col = (key) => (cast[key] && cast[key].color) || '#888888';
  const nm = (key) => (cast[key] && cast[key].name) || key || '';
  const wordMap = {};
  for (const x of ch.highlights || []) {
    wordMap[`${x.id}@${id}`] = { id: `${x.id}@${id}`, lemma: x.lemma, pos: x.pos, definition_fr: x.definition_fr, translation_en: x.translation_en,
      example: x.example, cefr: x.cefr, surface: x.surface, chapter: ch.meta.number, chapter_id: id, chapter_title: ch.meta.title };
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
        const bub = h('div', { class: 'bub' }, richText(seg, ch, id));
        node = h('div', { class: 'line' + (me ? ' me' : '') }, h('span', { class: 'who' }, nm(who)), bub);
        setColor(node, col(who));
        break;
      }
      case 'thought': {
        const me = who === mainP;
        node = h('div', { class: 'line th' + (me ? ' me' : '') }, me ? null : h('span', { class: 'who' }, nm(who)),
          h('div', { class: 'thought' }, richText(seg, ch, id)));
        setColor(node, col(who));
        break;
      }
      case 'message': {
        const m = seg.message || {};
        const sender = m.sender || seg.speaker;
        const key = (m.chat || '') + '|' + seg.perspective;
        if (!chat || chatKey !== key || chat.parentNode !== parent) {
          chat = h('div', { class: 'chat' }, h('div', { class: 'chat-head' }, m.chat || 'Messages', h('small', null, 'messages')), h('div', { class: 'chat-body' }));
          chatKey = key;
          parent.append(chat);
        }
        const named = (m.chat || '') !== nm(sender);
        const bubble = h('div', { class: 'msg' + (sender === mainP ? ' out' : ''), dataset: { seg: seg.id } },
          named ? h('b', { style: 'font-size:12px;display:block' }, nm(sender)) : null,
          richText(seg, ch, id), h('time', null, m.time || ''));
        setColor(bubble, col(sender));
        $('.chat-body', chat).append(bubble);
        continue;
      }
      case 'document':
        node = h('div', { class: 'doc' }, richText(seg, ch, id));
        break;
      default: // narration et types inconnus
        node = h('p', { class: 'narr', style: 'margin:0' }, richText(seg, ch, id));
        setColor(node, col(seg.perspective));
    }
    node.dataset.seg = seg.id;
    parent.append(node);
  }

  const bar = h('i');
  const head = h('div', { class: 'rhead' },
    h('div', { class: 'row' }, h('a', { href: '#/' }, '‹ Chapitres'),
      h('div', { class: 'ttl' }, `${ch.meta.number}. ${ch.meta.title}`), h('span', { class: 'sp' })),
    h('div', { class: 'bar' }, bar));
  const endBox = buildEnd(ch, id);
  fill(v, head, stream, endBox);

  stream.addEventListener('click', (e) => {
    const t = e.target.closest('.hl, .rv');
    if (!t) return;
    if (t.classList.contains('hl')) openCard(wordMap[t.dataset.wid]);
    else {
      const w = state.vocab.words[t.dataset.ref];
      openCard(w || { id: t.dataset.ref, lemma: t.dataset.lemma, pos: '', cefr: '', note: 'Mot de ton dictionnaire.' });
    }
  });

  /* position de lecture */
  const segEls = [...v.querySelectorAll('[data-seg]')];
  const rec0 = getRec(id);
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
      if (k > maxIdx && !getRec(id).progress.completed) {
        maxIdx = k;
        const r = touch(id);
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

function buildEnd(ch, id) {
  const r0 = getRec(id);
  const form = { choice: r0.choice_id, diff: r0.feedback.difficulty, interest: r0.feedback.interest, comment: r0.feedback.comment || '' };
  const box = h('section', { class: 'end' });
  const lastSeg = ch.segments[ch.segments.length - 1].id;
  const render = () => {
    const done = !!getRec(id).submitted_at;
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
        const r = touch(id);
        r.choice_id = form.choice;
        r.feedback = { difficulty: form.diff, interest: form.interest, comment: form.comment.trim() || null };
        r.progress = { last_segment_id: lastSeg, completed: true };
        r.submitted_at = nowISO();
        saveState();
        scheduleSync(600);
        render();
      } }, done ? 'Mettre à jour' : 'Valider mon choix', hintIn(done ? 'update' : 'confirm')),
      done ? h('p', { class: 'saved-note' }, '✓ Enregistré. ', h('span', { 'data-sync': '', style: 'font-weight:400;color:var(--muted)' }, statusText())) : null,
      done ? askNextBlock(id) : null,
      done ? h('a', { class: 'btn ghost', href: '#/', style: 'text-align:center;text-decoration:none' }, 'Retour aux chapitres') : null
    );
  };
  render();
  const hook = () => { if (getRec(id).submitted_at) render(); };
  syncHooks.add(hook);
  endHookCleanup = () => syncHooks.delete(hook);
  return box;
}

/* ---------- Fiche d'un mot ---------- */

function closeSheet() { $('#sheet').hidden = true; $('#backdrop').hidden = true; }
function refreshHighlights() {
  document.querySelectorAll('.hl').forEach((e) => e.classList.toggle('saved', !!state.vocab.words[e.dataset.wid]));
}
function openCard(w) {
  if (!w) return;
  const sheet = $('#sheet');
  const saved = !!state.vocab.words[w.id];
  const lab = (t) => h('div', { class: 'card-lab' }, t);
  const full = state.vocab.words[w.id] || w;
  fill(sheet, 
    h('div', { class: 'grab' }),
    h('div', { class: 'card-lemma' }, full.lemma),
    h('div', { class: 'card-pos' }, [full.pos, full.cefr].filter(Boolean).join(' · ')),
    full.definition_fr ? [lab('Définition'), h('div', { class: 'card-val' }, full.definition_fr)] : null,
    full.translation_en ? [lab('English'), h('div', { class: 'card-val' }, full.translation_en)] : null,
    full.example ? [lab('Exemple'), h('div', { class: 'card-val ex' }, full.example)] : null,
    full.note ? h('p', { class: 'card-val' }, full.note) : null,
    full.chapter_title ? h('div', { class: 'card-src' }, `Chapitre ${full.chapter} · ${full.chapter_title}`) : null,
    saved
      ? [h('div', { class: 'saved-note' }, '✓ Dans ton dictionnaire'),
         h('button', { class: 'btn danger', onclick: () => {
           if (!confirm('Retirer ce mot du dictionnaire ?')) return;
           removeWord(w.id); closeSheet(); afterWordChange();
         } }, 'Retirer du dictionnaire')]
      : (w.chapter_id ? h('button', { class: 'btn', onclick: () => { addWord(w); afterWordChange(); openCard(w); } }, 'Ajouter au dictionnaire', hintIn('add')) : null),
    h('button', { class: 'btn ghost', onclick: closeSheet }, 'Fermer')
  );
  sheet.hidden = false;
  $('#backdrop').hidden = false;
  sheet.scrollTop = 0;
}
function addWord(w) {
  ensureRec(w.chapter_id);
  delete state.vocab.deleted[w.id];
  state.vocab.words[w.id] = Object.assign({}, w, { added_at: nowISO() });
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
  const all = Object.values(state.vocab.words).sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
  const listBox = h('div');
  const renderList = () => {
    const hide = !!state.ui.hideTr;
    const q = norm(wordQuery);
    const shown = q ? all.filter((w) => norm([w.lemma, w.translation_en, w.definition_fr].join(' ')).includes(q)) : all;
    fill(listBox, shown.length
      ? h('div', { class: 'wlist' }, shown.map((w) => h('button', { class: 'wrow', onclick: () => openCard(w) },
          h('b', null, w.lemma), ' ', h('span', { class: 'tr' + (hide ? ' blur' : '') }, w.translation_en),
          h('div', { class: 'meta' }, `${w.pos} · ${w.cefr} · chapitre ${w.chapter}`))))
      : h('p', { class: 'empty' }, all.length ? 'Aucun résultat.' : 'Aucun mot pour l\'instant. Touche un mot souligné pendant la lecture.',
          h('br'), hint(all.length ? 'no results' : 'no words yet: tap an underlined word while reading')));
  };
  fill(v, 
    h('h1', { class: 'page-title' }, 'Dictionnaire'),
    h('p', { class: 'page-sub' }, `${all.length} mot${all.length > 1 ? 's' : ''} `, hint(`${all.length} saved word${all.length === 1 ? '' : 's'}`)),
    h('div', { class: 'tools' },
      h('input', { type: 'search', placeholder: 'Chercher…', value: wordQuery, oninput: (e) => { wordQuery = e.target.value; renderList(); } }),
      h('label', null, h('input', { type: 'checkbox', checked: state.ui.hideTr ? 'checked' : null,
        onchange: (e) => { state.ui.hideTr = e.target.checked; saveState(); renderList(); } }),
      h('span', null, 'Cacher la traduction', h('br'), hint('hide translation')))),
    listBox
  );
  renderList();
}

/* ---------- Réglages ---------- */

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

route();
syncNow();
