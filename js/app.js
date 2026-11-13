import { createStore } from './store.js';
import { leagueId } from '../firebase-config.js';
import {
  FIS_POINTS, DEFAULT_BONUS, DEFAULT_CHAMP, DEFAULT_PENALTY, TRIPLE, TEAM, TEAM_SIZE, buildWeekends, isLocked,
  snakeOrder, teams, canPick, lineupFor, validLineup, computeAll, racePoints, longestJump, wcStandings,
  countsForLeague, isMain, recordIds, scoringSettings,
  raceStart, lockTime, firstRace, canTriple,
} from './scoring.js';
import {
  esc, icon, flag, avatar, toast, modal, confirmModal, choose, hash, randomId, COLORS, LOGO, LOGO_DARK, MOUNTAINS,
} from './ui.js';

// ================================================================ stan

const DATA = 'data';
const root = document.getElementById('root');

let state = null;        // wspólny stan ligi (Firebase / localStorage)
let store = null;
let athletes = [];       // data/athletes.json
let athSeason = 0;       // sezon, dla którego zbudowano listę (ranking = sezon wcześniejszy)
let byId = {};
let calendar = null;
let standings = null;    // data/standings.json (końcowa klasyfikacja zeszłego sezonu)
let weekends = [];
let results = {};        // raceId -> wyniki
let calc = null;
let lastPicks = null;
let localPick = null;   // wybór zrobiony na tym urządzeniu – bez podwójnego powiadomienia

const ui = {
  authMode: null, gender: 'ALL', q: '', hideTaken: true, weekend: null, editRecord: false, limit: 150,
  wcGender: 'M', wcSeason: 'current', menu: false,
};

const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* tryb prywatny */ } },
};
const SESSION_KEY = `skoki-session-${leagueId || 'main'}`;
let session = LS.get(SESSION_KEY, {});   // { pid, pinHash, adminHash }

// ================================================================ pomocnicze

const fmtDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
const fmtDow = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
const range = (a, b) => {
  if (a === b) return fmtDay(a);
  const da = new Date(a + 'T12:00:00'); const db = new Date(b + 'T12:00:00');
  return da.getMonth() === db.getMonth() ? `${da.getDate()}–${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`;
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysTo = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
const inDays = (n) => (n === 0 ? 'dziś' : n === 1 ? 'jutro' : `za ${n} dni`);
const pl = (n, one, few, many) => {
  const m10 = n % 10; const m100 = n % 100;
  if (n === 1) return one;
  return m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const seasonLabel = (s) => `${s - 1}/${String(s).slice(2)}`;

const P = (pid) => state.participants.find((p) => p.id === pid);
const pname = (pid) => P(pid)?.name ?? '?';
const me = () => (session.pid && P(session.pid)?.pinHash === session.pinHash ? P(session.pid) : null);
const isAdmin = () => !!state.setup && session.adminHash === state.setup.adminHash;
const phase = () => (!state.draftStarted ? 'signup' : state.picks.length < state.draftOrder.length * TEAM_SIZE ? 'draft' : 'season');

const prettyName = (full) => {
  const parts = String(full || '').split(' ');
  const last = parts.filter((x) => x === x.toUpperCase() && /[A-ZÀ-Ž]/.test(x));
  const first = parts.filter((x) => !last.includes(x));
  return { first: first.join(' '), last: last.map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(' ') || full };
};
const athInfo = (id, fallback) => byId[id] || fallback || { id, name: id, nation: '' };
function ath(id, { fallback, short = false, gender = true, photo = false } = {}) {
  const a = athInfo(id, fallback);
  const n = prettyName(a.name);
  const g = gender && a.gender ? `<span class="g ${a.gender === 'W' ? 'w' : ''}">${a.gender === 'W' ? 'K' : 'M'}</span>` : '';
  return `<span class="ath">${photo ? portrait(a) : g}${flag(a.nation)}<span class="nm">${short ? '' : esc(n.first) + ' '}<b>${esc(n.last)}</b></span></span>`;
}
// Portret z FIS albo inicjały, gdy FIS nie ma zdjęcia.
function portrait(a, cls = '') {
  const n = prettyName(a.name);
  const ini = `${n.first.charAt(0)}${n.last.charAt(0)}`;
  const w = a.gender === 'W' ? 'w' : '';
  return a.photo
    ? `<img class="ph ${cls} ${w}" src="${DATA}/${esc(a.photo)}" alt="" loading="lazy">`
    : `<span class="ph ini ${cls} ${w}">${esc(ini)}</span>`;
}
const ownerOf = (aid) => Object.entries(calc.teams).find(([, ids]) => ids.includes(aid))?.[0];
function owner(pid, extra = '') {
  const p = P(pid);
  if (!p) return '<span class="muted xs">wolny</span>';
  return `<span class="owner"><span class="sw" style="background:${p.color}"></span>${esc(p.name)}${extra}</span>`;
}
const raceLabel = (r) => `${r.category === 'QUA' ? 'Kwalifikacje' : 'Konkurs'} ${r.gender === 'W' ? 'kobiet' : 'mężczyzn'}`;
const CHAMP = 'Mistrzostwa Świata';
const champTag = (cls = '') => `<span class="tag champ ${cls}">${icon('star')}${CHAMP}</span>`;
const hillShort = (d) => (/Flying/.test(d) ? 'mamucia' : /Normal/.test(d) ? 'normalna' : 'duża');

const raceStarted = (r) => new Date() >= raceStart(r);
// godzina startu w czasie przeglądarki (FIS podaje czas lokalny skoczni)
const localTime = (r) => raceStart(r).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

function weekendStatus(w) {
  const t = today();
  if (t > w.end) return 'past';
  if (t >= w.start) return 'live';
  return 'next';
}
const currentWeekend = () => weekends.find((w) => weekendStatus(w) !== 'past') || weekends[weekends.length - 1];
const lockLabel = (w) => {
  const d = lockTime(w);
  const txt = d.toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return firstRace(w)?.time ? txt : `${txt} (FIS nie podał jeszcze godziny startu)`;
};

async function save(fn, okMsg) {
  try {
    await store.update(fn);
    if (okMsg) toast(okMsg, 'ok');
    return true;
  } catch (e) {
    toast(e.message || String(e), 'err');
    return false;
  }
}
const fail = (msg) => { throw new Error(msg); };

// ================================================================ start

async function loadData() {
  const get = async (p) => {
    const r = await fetch(`${DATA}/${p}?v=${Date.now()}`);
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [a, c, s] = await Promise.all([get('athletes.json'), get('calendar.json'), get('standings.json').catch(() => null)]);
  athletes = a.athletes;
  athSeason = a.season;
  byId = Object.fromEntries(athletes.map((x, i) => [x.id, { ...x, idx: i + 1 }]));
  calendar = c;
  standings = s;
  weekends = buildWeekends(c.events.filter((e) => !e.cancelled));
  const races = weekends.flatMap((w) => w.races).filter((r) => r.hasResults);
  const bundle = await get('results.json').catch(() => ({}));
  const missing = races.filter((r) => !bundle[r.id]);
  const loaded = await Promise.all(missing.map((r) => get(`results/${r.id}.json`).catch(() => null)));
  missing.forEach((r, i) => { if (loaded[i]) bundle[r.id] = loaded[i]; });
  for (const r of races) if (bundle[r.id]) results[r.id] = bundle[r.id];
}

async function init() {
  try {
    await loadData();
  } catch (e) {
    root.innerHTML = `<div class="wrap"><div class="card empty">${icon('info')}<b>Nie udało się wczytać danych FIS</b>${esc(e.message)}</div></div>`;
    return;
  }
  store = await createStore((s) => {
    if (lastPicks !== null && s.picks.length > lastPicks && s.picks.length) {
      const i = s.picks.length - 1;
      const pid = snakeOrder(s.draftOrder)[i]?.pid;
      const p = s.participants.find((x) => x.id === pid);
      const n = prettyName(athInfo(s.picks[i]).name);
      if (pid !== session.pid && s.picks[i] !== localPick) toast(`${p?.name ?? '?'} wybiera: ${n.first} ${n.last}`);
    }
    lastPicks = s.picks.length;
    state = s;
    render();
  });
  window.addEventListener('hashchange', () => { ui.menu = false; ui.navMore = false; ui.editRecord = false; render(true); });
}

// ================================================================ render

const NAV = [
  ['ranking', 'Ranking', 'trophy'],
  ['druzyny', 'Drużyny', 'team'],
  ['kalendarz', 'Kalendarz', 'calendar'],
  ['puchar', 'Puchar Świata', 'globe'],
  ['draft', 'Draft', 'draft'],
  ['zawodnicy', 'Zawodnicy', 'list'],
  ['zasady', 'Zasady', 'info'],
  ['admin', 'Admin', 'settings'],
];

function render(scrollTop = false) {
  if (!state) return;
  calc = computeAll(state, weekends, results, byId);
  const kept = keepInputs();
  if (!state.setup) { root.innerHTML = screenCreate(); restoreInputs(kept); return; }
  if (!me() && !isAdmin()) {
    if (location.hash === '#zasady') { root.innerHTML = `<main class="wrap"><a class="back" href="#">${icon('back')}Logowanie</a>${zasady()}</main>`; return; }
    root.innerHTML = screenAuth(); restoreInputs(kept); return;
  }

  const [view, arg] = (location.hash.slice(1) || 'ranking').split('/');
  const views = { ranking, druzyny, kalendarz, race: raceView, puchar, draft, zawodnicy, zasady, admin: adminView, wiecej };
  const fn = views[view] && (view !== 'admin' || isAdmin()) ? views[view] : ranking;
  const active = view === 'race' ? 'kalendarz' : views[view] ? view : 'ranking';
  const y = window.scrollY;
  const focusId = document.activeElement?.id;
  const sel = focusId && document.activeElement.selectionStart;

  const weeksScroll = document.getElementById('weeks')?.scrollLeft;
  root.innerHTML = shell(active, fn(arg));
  restoreInputs(kept);
  const weeks = document.getElementById('weeks');
  if (weeks) {
    const on = weeks.querySelector('.on');
    weeks.scrollLeft = weeksScroll ?? (on ? on.offsetLeft - weeks.clientWidth / 2 + on.clientWidth / 2 : 0);
  }
  if (!scrollTop) window.scrollTo(0, y); else window.scrollTo(0, 0);
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch { /* nie input tekstowy */ } }
  }
}

// Wartości wpisane przez użytkownika (a jeszcze nie zapisane) przeżywają odświeżenie widoku,
// np. gdy w tym czasie ktoś inny dołączy do ligi.
function keepInputs() {
  const out = [];
  for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=file]), textarea, form select')) {
    const key = el.id || el.name;
    const dirty = el.tagName === 'SELECT' ? el.closest('form[data-form]') : el.value !== el.defaultValue;
    if (key && dirty && !el.dataset.action) out.push([key, el.value, el === document.activeElement]);
  }
  return out;
}
function restoreInputs(kept) {
  for (const [key, value, focused] of kept) {
    const el = document.getElementById(key) || root.querySelector(`[name="${key}"]`);
    if (!el) continue;
    el.value = value;
    if (focused) el.focus();
  }
}

function shell(active, content) {
  const m = me();
  const ph = phase();
  const myTurn = ph === 'draft' && m && snakeOrder(state.draftOrder)[state.picks.length]?.pid === m.id;
  // w górnym pasku najważniejsze zakładki + Zasady; reszta pod „Więcej”
  const MORE = ['zawodnicy', 'admin'];
  const nav = NAV.filter(([k]) => !MORE.includes(k));
  const more = NAV.filter(([k]) => MORE.includes(k) && (k !== 'admin' || isAdmin()));
  const moreActive = MORE.includes(active);
  const dot = (k) => (k === 'draft' && (myTurn || (ph === 'draft' && !m)) ? '<span class="dot"></span>' : '');
  const fifth = ph === 'draft' ? ['draft', 'Draft', 'draft'] : ['wiecej', 'Więcej', 'menu'];
  const tabs = [NAV[0], NAV[1], NAV[2], ['puchar', 'PŚ', 'globe'], fifth];
  const who = m || { name: 'Admin', color: '#64748b' };

  return `
  <header class="top"><div class="top__inner">
    <a class="brand" href="#ranking">${LOGO}<span>Draft Skoków<small>${esc(state.setup.leagueName)} · sezon ${seasonLabel(calendar.season)}</small></span></a>
    <nav class="nav">${nav.map(([k, l, i]) => `<a href="#${k}" class="${active === k ? 'active' : ''}">${icon(i)}${l}${dot(k)}</a>`).join('')}
      <span class="navmore"><button type="button" class="navbtn ${moreActive ? 'active' : ''}" data-action="navMore" aria-expanded="${ui.navMore ? 'true' : 'false'}">${icon('menu')}Więcej ▾</button>
        ${ui.navMore ? `<div class="menu navmenu">${more.map(([k, l, i]) => `<a href="#${k}">${icon(i)}${l}</a>`).join('')}</div>` : ''}</span></nav>
    <span class="spacer-top"></span>
    <button class="userchip" data-action="menu">${avatar(who, 'sm')}<span>${esc(who.name)}</span>${isAdmin() ? '<span class="badge-admin">ADMIN</span>' : ''}</button>
  </div>
  ${ui.menu ? userMenu() : ''}
  </header>
  ${store.mode === 'local' ? '<div class="banner">Tryb testowy — dane ligi zapisują się tylko w tej przeglądarce. Podłącz Firebase, żeby grać razem (README).</div>' : ''}
  <main class="wrap">${content}</main>
  <footer class="foot"><span>Dane: oficjalne wyniki FIS</span><span>Aktualizacja: ${new Date(calendar.updated).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></footer>
  <nav class="tabbar">${tabs.map(([k, l, i]) => `<a href="#${k}" class="${active === k || (k === 'wiecej' && ['zawodnicy', 'admin', 'draft', 'zasady', 'wiecej'].includes(active)) ? 'active' : ''}">${icon(i)}${l}${k === 'draft' && myTurn ? '<span class="dot"></span>' : ''}</a>`).join('')}</nav>`;
}

function userMenu() {
  const m = me();
  return `<div class="menu">
    <div class="who"><b>${esc(m?.name || 'Administrator')}</b><div class="muted xs">${m ? (isAdmin() ? 'gracz · administrator' : 'gracz') : 'tylko administrator'}</div></div>
    <hr>
    ${m ? `<button data-action="changePin">${icon('key')}Zmień PIN</button>` : `<button data-action="joinAsAdmin">${icon('plus')}Dołącz jako gracz</button>`}
    ${isAdmin() ? `<a href="#admin">${icon('settings')}Panel admina</a><button data-action="adminOff">${icon('lock')}Wyjdź z trybu admina</button>`
      : `<button data-action="adminOn">${icon('unlock')}Tryb administratora</button>`}
    <hr>
    <button data-action="logout">${icon('logout')}Wyloguj</button>
  </div>`;
}

// ================================================================ ekrany startowe

function authFrame(inner) {
  return `<div class="auth">${MOUNTAINS}<div class="auth-card">
    <div class="auth-logo">${LOGO_DARK}<div><div class="t">Draft Skoków</div><div class="s">${state.setup ? esc(state.setup.leagueName) + ' · ' : ''}sezon ${seasonLabel(calendar.season)}</div></div></div>
    ${inner}
  </div></div>`;
}

function screenCreate() {
  return authFrame(`
    <h2>Otwórz ligę</h2>
    <p class="lead">Jesteś tu pierwszy. Administrator zakłada ligę i ustawia hasło — potem pozostali gracze mogą się zapisać.</p>
    <form data-form="create" autocomplete="off">
      <label class="field"><span>Nazwa ligi</span><input name="league" maxlength="40" placeholder="np. Liga u Krystiana" required></label>
      <label class="field"><span>Hasło administratora</span><input name="pass" type="password" minlength="4" required autocomplete="new-password"></label>
      <label class="field"><span>Powtórz hasło</span><input name="pass2" type="password" minlength="4" required autocomplete="new-password"></label>
      <div class="formerr"></div>
      <button class="primary block" type="submit">${icon('unlock')}Otwórz ligę</button>
    </form>`);
}

function screenAuth() {
  const open = phase() === 'signup';
  const mode = ui.authMode || (open ? 'join' : 'login');
  const players = state.participants;
  const tabs = !open ? '' : `<div class="seg tabs">
    ${open ? `<button type="button" data-action="authMode" data-v="join" class="${mode === 'join' ? 'on' : ''}">Dołącz</button>` : ''}
    <button type="button" data-action="authMode" data-v="login" class="${mode === 'login' ? 'on' : ''}" ${!players.length ? 'disabled' : ''}>Zaloguj się</button>
  </div>`;
  let body = '';
  if (mode === 'admin') {
    body = `<h2>Administrator</h2><p class="lead">Podaj hasło administratora ligi.</p>
      <form data-form="adminLogin" autocomplete="off">
        <label class="field"><span>Hasło</span><input name="pass" type="password" required></label>
        <div class="formerr"></div>
        <button class="primary block" type="submit">${icon('unlock')}Wejdź</button>
      </form>`;
  } else if (mode === 'join') {
    body = `${tabs}<p class="lead">Wpisz swoje imię i wymyśl PIN — będzie potrzebny, żeby zalogować się na innym urządzeniu.</p>
      <form data-form="join" autocomplete="off">
        <label class="field"><span>Imię / ksywka</span><input name="name" maxlength="20" required></label>
        <div class="grid-2" style="gap:.75rem">
          <label class="field"><span>PIN (4–8 cyfr)</span><input name="pin" class="pinput" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" type="password" required autocomplete="new-password"></label>
          <label class="field"><span>Powtórz PIN</span><input name="pin2" class="pinput" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" type="password" required autocomplete="new-password"></label>
        </div>
        <div class="formerr"></div>
        <button class="primary block" type="submit">${icon('plus')}Dołącz do ligi</button>
      </form>`;
  } else {
    body = `${tabs}${!open ? '<p class="lead">Draft już wystartował — zapisy są zamknięte. Zaloguj się na swoje konto.</p>' : ''}
      <form data-form="login" autocomplete="off">
        <label class="field"><span>Kim jesteś?</span><select name="pid" required>${players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>PIN</span><input name="pin" class="pinput" inputmode="numeric" maxlength="8" type="password" required></label>
        <div class="formerr"></div>
        <button class="primary block" type="submit">Zaloguj</button>
      </form>`;
  }
  return authFrame(`${body}
    ${players.length ? `<div class="af" style="text-align:left"><div class="muted xs" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">W lidze (${players.length})</div>
      <div class="joined">${players.map((p) => `<span class="chip">${avatar(p, 'sm')}${esc(p.name)}</span>`).join('')}</div></div>` : ''}
    <div class="af">${mode === 'admin' ? '<button data-action="authMode" data-v="">← Wróć</button>' : '<button data-action="authMode" data-v="admin">Jestem administratorem</button> · <a href="#zasady">Zasady gry</a>'}</div>`);
}

// ================================================================ ranking

function nextWeekendHero() {
  const w = currentWeekend();
  if (!w) return '';
  const st = weekendStatus(w);
  const m = me();
  const ph = phase();
  let cta = '';
  if (ph === 'signup') {
    return `<div class="hero">${MOUNTAINS}<div class="eyebrow">Zapisy trwają</div><div class="big">Czekamy na graczy</div>
      <p>W lidze: ${state.participants.map((p) => esc(p.name)).join(', ') || 'nikt jeszcze'}. ${isAdmin() ? 'Gdy wszyscy dołączą, rozpocznij draft w panelu admina.' : 'Administrator rozpocznie draft, gdy wszyscy dołączą.'}</p>
      ${isAdmin() ? '<div class="row" style="margin-top:1rem;position:relative;z-index:1"><a class="btn" href="#admin">Panel admina</a></div>' : ''}</div>`;
  }
  if (ph === 'draft') {
    const cur = snakeOrder(state.draftOrder)[state.picks.length];
    return `<div class="hero">${MOUNTAINS}<div class="eyebrow">Draft na żywo</div><div class="big">${cur.pid === m?.id ? 'Twoja kolej!' : `Wybiera ${esc(pname(cur.pid))}`}</div>
      <p>Wybór ${state.picks.length + 1} z ${state.draftOrder.length * TEAM_SIZE}.</p>
      <div class="row" style="margin-top:1rem;position:relative;z-index:1"><a class="btn" href="#draft">Przejdź do draftu</a></div></div>`;
  }
  if (m) {
    const l = lineupFor(state, weekends, w.id, m.id, calc.teams[m.id] || [], byId);
    const capName = l.captain ? prettyName(athInfo(l.captain).name) : null;
    const used = state.triples?.[m.id];
    const ur = used && weekends.flatMap((x) => x.races).find((r) => r.id === used);
    const todo = [
      capName ? `<span class="todo ok">${icon('check')}Kapitan: ${esc(capName.last)}</span>` : `<span class="todo warn">${icon('info')}Wybierz kapitana</span>`,
      ur ? `<span class="todo ok">${icon('star')}×${TRIPLE}: ${raceLabel(ur)}, ${esc(ur.place)}</span>` : `<span class="todo">${icon('star')}Mnożnik ×${TRIPLE} dostępny</span>`,
    ].join('');
    cta = st === 'next'
      ? `<div class="todos">${todo}</div><p class="small" style="margin-top:.6rem">Zmiany do <b>${lockLabel(w)}</b></p>
         <div class="row" style="margin-top:1rem;position:relative;z-index:1"><a class="btn" href="#druzyny" data-week="${w.id}">${icon('team')}${capName ? 'Zmień skład' : 'Ustaw kapitana'}</a></div>`
      : `<div class="todos">${todo}</div><p class="small" style="margin-top:.6rem">${icon('lock')} Składy zablokowane do końca weekendu.</p>`;
  }
  const d = daysTo(w.start);
  if (st === 'past') {
    const champ = [...state.participants].sort((a, b) => calc.totals[b.id] - calc.totals[a.id])[0];
    return `<div class="hero">${MOUNTAINS}<div class="eyebrow">Sezon ${seasonLabel(calendar.season)} zakończony</div>
      <div class="big">🏆 Mistrz ligi: ${esc(champ?.name ?? '—')}</div><p>${champ ? `${calc.totals[champ.id]} pkt po ${weekends.length} weekendach.` : ''}</p></div>`;
  }
  return `<div class="hero ${w.champ ? 'champ' : ''}">${MOUNTAINS}
    <div class="eyebrow">${w.champ ? `${CHAMP} · ` : ''}${st === 'live' ? 'Trwa weekend' : `Następny weekend · ${inDays(d)}`}</div>
    <div class="big">${esc(w.name)}</div>
    <p style="margin-bottom:.4rem">${range(w.start, w.end)} · ${w.races.filter((r) => r.category === 'WC').length} ${pl(w.races.filter((r) => r.category === 'WC').length, 'konkurs', 'konkursy', 'konkursów')}</p>
    ${st !== 'past' ? cta : ''}</div>`;
}

function ranking() {
  const ps = [...state.participants].sort((a, b) => calc.totals[b.id] - calc.totals[a.id]);
  const played = weekends.filter((w) => w.races.some((r) => results[r.id]));
  const top = ps.length ? calc.totals[ps[0].id] : 0;
  const best = Object.entries(calc.athleteTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);

  let html = `<div class="page-head"><div><h1>Ranking ligi</h1><div class="sub">${played.length} z ${weekends.length} weekendów rozegranych</div></div></div>
    ${nextWeekendHero()}`;

  if (!ps.length) return html;
  if (!played.length) {
    return html + `<div class="section"><div class="row"><h2>Gracze</h2></div><div class="podium">${ps.map((p) => `<div class="pcard">${avatar(p, 'lg')}
      <div class="who"><div class="nm">${esc(p.name)}${p.id === me()?.id ? ' <span class="tag acc">Ty</span>' : ''}</div>
      <div class="gap">${(calc.teams[p.id] || []).length}/${TEAM_SIZE} zawodników</div></div>
      <div class="bar" style="background:${p.color};width:100%"></div></div>`).join('')}</div></div>
      <div class="section card empty">${icon('snow')}<b>Sezon jeszcze nie wystartował</b>
      Punkty pojawią się po pierwszym konkursie${weekends[0] ? ` — ${esc(weekends[0].name)}, ${fmtLong(weekends[0].races[0]?.date || weekends[0].start)}` : ''}.</div>`;
  }
  html += `<div class="section"><div class="podium">${ps.map((p, i) => {
    const pos = i > 0 && calc.totals[ps[i - 1].id] === calc.totals[p.id] ? '=' : i + 1;
    return `<div class="pcard p${i + 1}">
      <div class="pos">${pos}</div>${avatar(p, 'lg')}
      <div class="who"><div class="nm">${esc(p.name)}${p.id === me()?.id ? ' <span class="tag acc">Ty</span>' : ''}</div>
        <div class="pts">${calc.totals[p.id]}<small>pkt</small></div>
        <div class="gap">${i === 0 ? (top ? 'lider' : '&nbsp;') : `−${top - calc.totals[p.id]} do lidera`}</div></div>
      <div class="bar" style="background:${p.color};width:${top ? (calc.totals[p.id] / top) * 100 : 0}%"></div>
    </div>`;
  }).join('')}</div></div>`;


  // wykres narastająco
  html += `<div class="section card"><div class="row" style="margin-bottom:.6rem"><h2>Przebieg sezonu</h2><span class="spacer"></span>
    <div class="legend">${ps.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.name)}</span>`).join('')}</div></div>
    ${chart(ps, played)}</div>`;

  // tabela weekendów
  html += `<div class="section"><div class="row"><h2>Punkty w weekendach</h2></div>
    <div class="card pad0"><div class="tablewrap"><table>
    <thead><tr><th>Weekend</th>${ps.map((p) => `<th class="num">${avatar(p, 'sm')}</th>`).join('')}</tr></thead>
    <tbody>${played.slice().reverse().map((w) => {
      const vals = ps.map((p) => calc.byWeekend[w.id][p.id]);
      const max = Math.max(...vals);
      return `<tr><td><a href="#kalendarz" data-week="${w.id}"><b>${w.no}.</b> ${esc(w.name)}</a>${w.champ ? ' <span class="tag champ sm">MŚ</span>' : ''} <span class="muted xs">${range(w.start, w.end)}</span></td>
        ${vals.map((v) => `<td class="num ${v === max && v > 0 ? 'best' : ''}">${v}</td>`).join('')}</tr>`;
    }).join('')}
    <tr><td><b>Razem</b></td>${ps.map((p) => `<td class="pts">${calc.totals[p.id]}</td>`).join('')}</tr>
    </tbody></table></div></div></div>`;

  // statystyki
  const capPts = {}; const bonusCnt = {};
  for (const p of ps) { capPts[p.id] = 0; bonusCnt[p.id] = 0; }
  for (const byP of Object.values(calc.byRace)) {
    for (const [pid, e] of Object.entries(byP)) {
      for (const a of e.athletes) {
        if (a.captain) capPts[pid] += a.pts / 2;
        bonusCnt[pid] += (a.base.quali ? 1 : 0) + (a.base.longest ? 1 : 0) + (a.base.record ? 1 : 0);
      }
    }
  }
  const wins = {}; for (const p of ps) wins[p.id] = 0;
  for (const w of played) {
    const max = Math.max(...ps.map((p) => calc.byWeekend[w.id][p.id]));
    if (max > 0) ps.filter((p) => calc.byWeekend[w.id][p.id] === max).forEach((p) => { wins[p.id]++; });
  }
  html += `<div class="section grid-2">
    <div class="card pad0"><div class="card-head"><h3>Najlepsi zawodnicy w lidze</h3></div><div class="tablewrap"><table><tbody>
      ${best.map(([id, v], i) => `<tr><td class="rank muted">${i + 1}</td><td>${ath(id, { photo: true, gender: false })}</td><td>${owner(ownerOf(id))}</td><td class="pts">${v}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}
    </tbody></table></div></div>
    <div class="card pad0"><div class="card-head"><h3>Statystyki</h3></div><div class="tablewrap"><table>
      <thead><tr><th></th><th class="num">Wygrane weekendy</th><th class="num">Pkt od kapitanów</th><th class="num">Kary</th><th class="num">Bonusy</th><th class="num">×${TRIPLE}</th></tr></thead><tbody>
      ${ps.map((p) => {
        const t = state.triples?.[p.id];
        const tv = t && calc.byRace[t]?.[p.id];
        return `<tr><td>${owner(p.id)}</td><td class="num">${wins[p.id]}</td><td class="num">+${capPts[p.id]}</td>
          <td class="num" style="color:${calc.penalties[p.id] ? 'var(--bad)' : 'inherit'}">${calc.penalties[p.id]}</td><td class="num">${bonusCnt[p.id]}</td>
          <td class="num">${tv ? `${tv.total > 0 ? '+' : ''}${tv.total}` : '<span class="muted">dostępny</span>'}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>
  </div>`;
  return html;
}

function chart(ps, played) {
  const W = 800; const H = 260; const L = 44; const R = 70; const T = 14; const B = 30;
  const series = ps.map((p) => {
    let s = 0;
    return [0, ...played.map((w) => (s += calc.byWeekend[w.id][p.id]))];
  });
  const max = Math.max(10, ...series.flat());
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * nice).find((s) => max / s <= 5) || nice * 10;
  const ymax = Math.ceil(max / step) * step;
  const n = played.length;
  const x = (i) => L + (n ? (i / n) * (W - L - R) : 0);
  const y = (v) => T + (1 - v / ymax) * (H - T - B);
  const ticks = []; for (let v = 0; v <= ymax; v += step) ticks.push(v);
  const labels = played.map((w, i) => ({ i: i + 1, w })).filter((_, i) => n <= 12 || i % Math.ceil(n / 12) === 0 || i === n - 1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Punkty narastająco">
    <g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}</g>
    ${labels.map(({ i, w }) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle"><title>${esc(w.name)}</title>${w.no}</text>`).join('')}
    <text x="${L}" y="${H - 8}" text-anchor="start" style="font-size:10px">weekend →</text>
    ${series.map((s, k) => `<polyline fill="none" stroke="${ps[k].color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${s.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>
      <circle cx="${x(n)}" cy="${y(s[n])}" r="4.5" fill="${ps[k].color}"/>
      <text x="${x(n) + 9}" y="${y(s[n]) + 4}" style="fill:${ps[k].color};font-weight:800">${s[n]}</text>`).join('')}
  </svg>`;
}

// ================================================================ draft

function draft() {
  const ph = phase();
  const m = me();
  if (ph === 'signup') {
    return `<div class="page-head"><div><h1>Draft</h1><div class="sub">Snake draft · ${TEAM_SIZE} zawodników na gracza (${TEAM.men} M + ${TEAM.women} K + ${TEAM.reserves} rezerwowych)</div></div></div>
      <div class="card empty">${icon('clock')}<b>Draft jeszcze się nie zaczął</b>
      ${state.participants.length} ${pl(state.participants.length, 'gracz', 'graczy', 'graczy')} w lidze. ${isAdmin() ? 'Ustaw kolejność i rozpocznij draft w panelu admina.' : 'Administrator rozpocznie draft, gdy wszyscy dołączą.'}
      ${isAdmin() ? '<div style="margin-top:1rem"><a class="btn primary" href="#admin">Panel admina</a></div>' : ''}</div>
      ${athleteTable(false)}`;
  }
  const seq = snakeOrder(state.draftOrder);
  const n = state.picks.length;
  const cur = seq[n];
  const done = ph === 'season';
  const Pn = state.draftOrder.length;

  let hero = '';
  if (done) {
    hero = `<div class="hero">${MOUNTAINS}<div class="eyebrow">Draft zakończony</div><div class="big">Drużyny gotowe!</div>
      <p>Teraz przed każdym weekendem wybierajcie kapitana.</p><div class="row" style="margin-top:1rem;position:relative;z-index:1"><a class="btn" href="#druzyny">Zobacz drużyny</a></div></div>`;
  } else {
    const p = P(cur.pid);
    const t = calc.teams[cur.pid] || [];
    const men = t.filter((id) => byId[id]?.gender === 'M').length;
    const wom = t.filter((id) => byId[id]?.gender === 'W').length;
    const mine = cur.pid === m?.id;
    // gdy zostały już tylko miejsca dla jednej płci – ostrzeżenie i automatyczny filtr
    const must = !canPick(t, 'M', byId) ? 'W' : !canPick(t, 'W', byId) ? 'M' : null;
    const left = TEAM_SIZE - t.length;
    const mustTxt = must === 'W' ? 'kobietę' : 'mężczyznę';
    if (must && (mine || isAdmin()) && ui.autoGender !== n) {
      ui.autoGender = n;
      ui.gender = must;
      ui.limit = 150;
      toast(mine ? `Teraz musisz wybrać ${mustTxt} — pokazuję tylko ${must === 'W' ? 'kobiety' : 'mężczyzn'}` : `${p.name} musi teraz wybrać ${mustTxt}`, 'warn');
    }
    const alert = must
      ? `<div class="mustline">${icon('info')}<span>${mine ? `<b>Teraz musisz wybrać ${mustTxt}</b> — inaczej nie skompletujesz składu (${TEAM.men} M + ${TEAM.women} K).` : `<b>${esc(p.name)} musi teraz wybrać ${mustTxt}.</b>`}</span></div>`
      : wom < TEAM.women && left <= 3
        ? `<div class="mustline soft">${icon('info')}<span>${mine ? 'Pamiętaj' : esc(p.name)}: w drużynie nie ma jeszcze kobiety — zostały ${left} ${pl(left, 'wybór', 'wybory', 'wyborów')}.</span></div>`
        : '';
    hero = `<div class="hero"><div class="clock">${avatar(p, 'xl')}
      <div class="who"><div class="eyebrow">Wybór ${n + 1} z ${seq.length} · runda ${cur.round}</div>
        <div class="big">${mine ? 'Twoja kolej!' : `Wybiera ${esc(p.name)}`}</div>
        <div class="needs"><span class="need ${men >= TEAM.men ? 'done' : ''}">Mężczyźni ${Math.min(men, TEAM.men)}/${TEAM.men}</span>
          <span class="need ${wom >= TEAM.women ? 'done' : ''}">Kobieta ${Math.min(wom, TEAM.women)}/${TEAM.women}</span>
          <span class="need">Rezerwa ${Math.max(0, t.length - Math.min(men, TEAM.men) - Math.min(wom, TEAM.women))}/${TEAM.reserves}</span></div></div>
      ${n > 0 && (isAdmin() || seq[n - 1].pid === m?.id) ? `<button class="btn sm" data-action="undo" style="position:relative;z-index:1">${icon('undo')}Cofnij ostatni</button>` : ''}
    </div>${alert}</div>`;
  }

  const cells = [];
  for (let r = 0; r < TEAM_SIZE; r++) {
    for (let c = 0; c < Pn; c++) {
      const i = r * Pn + c;
      const s = seq[i];
      const col = state.draftOrder.indexOf(s.pid);
      const aid = state.picks[i];
      cells.push(`<div class="cell ${i === n ? 'now' : ''} ${!aid && i !== n ? 'empty-c' : ''}" style="grid-column:${col + 1};grid-row:${r + 2}">
        <span class="r">${r + 1}.${col + 1} · #${i + 1}</span>${aid ? ath(aid) : i === n ? '<span class="xs" style="color:var(--accent);font-weight:700">wybiera…</span>' : ''}</div>`);
    }
  }
  return `<div class="page-head"><div><h1>Draft</h1><div class="sub">Kolejność: ${state.draftOrder.map((pid) => esc(pname(pid))).join(' → ')} → i z powrotem</div></div></div>
    ${hero}
    <div class="section"><div class="row"><h2>Tablica</h2></div>
    <div class="boardwrap"><div class="board" style="grid-template-columns:repeat(${Pn}, minmax(150px, 1fr))">
      ${state.draftOrder.map((pid, c) => `<div class="head" style="grid-column:${c + 1};grid-row:1">${avatar(P(pid), 'sm')}<span>${esc(pname(pid))}</span></div>`).join('')}
      ${cells.join('')}
    </div></div></div>
    ${done ? '' : athleteTable(true)}`;
}

function athleteTable(picking) {
  const seq = snakeOrder(state.draftOrder);
  const cur = seq[state.picks.length];
  const taken = new Map(state.picks.map((aid, i) => [aid, seq[i]?.pid]));
  const myTurn = picking && cur && (cur.pid === me()?.id || isAdmin());
  const team = cur ? calc.teams[cur.pid] || [] : [];
  const q = ui.q.toLowerCase();
  const all = athletes.filter((a) => (ui.gender === 'ALL' || a.gender === ui.gender) &&
    (!ui.hideTaken || !taken.has(a.id)) && (!q || `${a.name} ${a.nation}`.toLowerCase().includes(q)));
  const list = all.slice(0, ui.limit);
  return `<div class="section"><div class="row"><h2>Zawodnicy</h2><span class="muted small">${all.length} ${pl(all.length, 'aktywny', 'aktywnych', 'aktywnych')} w FIS</span><span class="spacer"></span>
      ${picking && cur && !myTurn ? `<span class="tag">czekasz na swoją kolej</span>` : ''}
      ${picking && myTurn && cur.pid !== me()?.id ? `<span class="tag warn">admin: wybierasz za ${esc(pname(cur.pid))}</span>` : ''}</div>
    <div class="row" style="margin-bottom:.8rem">
      ${genderSeg()}
      <label class="search">${icon('search')}<input id="q" placeholder="Szukaj zawodnika lub kraju" value="${esc(ui.q)}"></label>
      ${picking ? `<label class="check small"><input type="checkbox" data-action="hideTaken" ${ui.hideTaken ? 'checked' : ''}>ukryj wybranych</label>` : ''}
    </div>
    <div class="card pad0"><div class="tablewrap"><table>
      <thead><tr><th class="num">#</th><th>Zawodnik</th><th class="num hide-sm">Rocznik</th><th class="num">PŚ ${seasonLabel(athSeason - 1)}</th><th class="num hide-sm">Miejsce</th><th class="num hide-sm">PK ${seasonLabel(athSeason - 1)}</th><th class="num hide-sm">LGP ${athSeason - 1}</th><th></th></tr></thead>
      <tbody>${list.map((a) => {
        const t = taken.get(a.id);
        const ok = !t && myTurn && canPick(team, a.gender, byId);
        return `<tr class="${t ? 'dim' : ''}">
          <td class="num muted">${byId[a.id].idx}</td>
          <td>${ath(a.id, { photo: true })}</td>
          <td class="num hide-sm muted">${a.born || ''}</td>
          <td class="pts">${a.wc || '<span class="muted">–</span>'}</td>
          <td class="num hide-sm">${a.wcRank ? `${a.wcRank}.` : '<span class="muted">–</span>'}</td>
          <td class="num hide-sm">${a.coc || '<span class="muted">–</span>'}</td>
          <td class="num hide-sm">${a.gp || '<span class="muted">–</span>'}</td>
          <td class="num">${t ? owner(t) : picking ? `<button class="sm ${ok ? 'primary' : ''}" data-action="pick" data-id="${a.id}" ${ok ? '' : 'disabled'}>Wybierz</button>` : ''}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="8" class="empty">Brak zawodników dla tego filtra</td></tr>'}</tbody></table></div></div>
    ${all.length > list.length ? `<div class="row" style="justify-content:center;margin-top:.8rem"><button data-action="more">Pokaż kolejnych ${Math.min(150, all.length - list.length)} (zostało ${all.length - list.length})</button></div>` : ''}</div>`;
}

const genderSeg = () => `<div class="seg">${[['ALL', 'Wszyscy'], ['M', 'Mężczyźni'], ['W', 'Kobiety']].map(([k, l]) =>
  `<button data-action="gender" data-v="${k}" class="${ui.gender === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

// ================================================================ drużyny

function druzyny() {
  const ph = phase();
  const head = `<div class="page-head"><div><h1>Drużyny</h1><div class="sub">Składy, kapitanowie i punkty w każdym weekendzie</div></div></div>`;
  if (ph !== 'season') {
    return head + `<div class="card empty">${icon('team')}<b>${ph === 'signup' ? 'Drużyny powstaną w drafcie' : 'Draft w toku'}</b>
      ${ph === 'draft' ? `Wybrano ${state.picks.length} z ${state.draftOrder.length * TEAM_SIZE} zawodników. <div style="margin-top:1rem"><a class="btn primary" href="#draft">Przejdź do draftu</a></div>` : 'Gdy wszyscy dołączą, administrator rozpocznie draft.'}</div>
      ${ph === 'draft' ? `<div class="grid section">${state.draftOrder.map((pid) => teamCard(P(pid), currentWeekend(), true)).join('')}</div>` : ''}`;
  }
  const w = weekends.find((x) => x.id === ui.weekend) || currentWeekend();
  ui.weekend = w.id;
  const locked = isLocked(w);
  const st = weekendStatus(w);
  const order = [...state.participants].sort((a, b) => (a.id === me()?.id ? -1 : b.id === me()?.id ? 1 : calc.totals[b.id] - calc.totals[a.id]));
  return head + `
    <div class="weeks" id="weeks">${weekends.map((x) => `<button data-action="weekend" data-v="${x.id}" class="${x.id === w.id ? 'on' : ''} ${x.champ ? 'champ' : ''}">
      <span class="d">${x.no}. · ${range(x.start, x.end)}${x.champ ? ' · MŚ' : ''}${weekendStatus(x) === 'live' ? ' · trwa' : ''}</span><span class="n">${esc(x.name)}</span></button>`).join('')}</div>
    <div class="row" style="margin:.5rem 0 1rem">
      ${locked ? `<span class="tag ${st === 'live' ? 'warn live' : ''}">${icon('lock')}${st === 'live' ? 'Weekend trwa — składy zablokowane' : 'Składy zablokowane'}</span>`
        : `<span class="tag good">${icon('unlock')}Zmiany do ${lockLabel(w)}</span>`}
      ${isAdmin() && locked ? '<span class="tag warn">admin może edytować</span>' : ''}
    </div>
    <div class="grid">${order.map((p) => teamCard(p, w, false)).join('')}</div>`;
}

function teamCard(p, w, drafting) {
  if (!p) return '';
  const ids = calc.teams[p.id] || [];
  const l = drafting ? { starters: ids, captain: null } : lineupFor(state, weekends, w.id, p.id, ids, byId);
  const locked = isLocked(w);
  const editable = !drafting && (p.id === me()?.id || isAdmin()) && (!locked || isAdmin()) && ids.length === TEAM_SIZE;
  const hasRes = w.races.some((r) => results[r.id]);
  const wpts = {};
  for (const r of w.races) for (const a of calc.byRace[r.id]?.[p.id]?.athletes || []) wpts[a.id] = (wpts[a.id] || 0) + a.pts;
  const reserves = ids.filter((id) => !l.starters.includes(id));

  const line = (id, starter) => {
    const a = byId[id];
    const isCap = l.captain === id;
    let ctrl = '';
    if (editable && starter) {
      ctrl = `<button class="capbtn ${isCap ? 'on' : ''}" data-action="captain" data-p="${p.id}" data-id="${id}" title="${isCap ? 'Kapitan (×2) — kliknij, by zdjąć' : 'Zrób kapitanem (×2)'}" aria-label="Kapitan">C</button>`;
    } else if (isCap) {
      ctrl = '<span class="cap" title="Kapitan — punkty ×2">C</span>';
    }
    if (editable && !starter) {
      ctrl = `<button class="sm" data-action="swap" data-p="${p.id}" data-id="${id}" title="Wstaw tego zawodnika do składu">${icon('swap')}Wstaw</button>`;
    }
    const v = hasRes ? wpts[id] || 0 : calc.athleteTotals[id] || 0;
    return `<div class="player ${starter ? '' : 'res'}">${ath(id, { gender: false, photo: true })}
      ${drafting ? '' : `<span class="pp ${v ? '' : 'z'}">${v}</span>`}${ctrl}</div>`;
  };
  const men = l.starters.filter((id) => byId[id]?.gender === 'M');
  const women = l.starters.filter((id) => byId[id]?.gender === 'W');
  const label = hasRes ? 'pkt w weekendzie' : 'pkt w sezonie';
  return `<div class="card team">
    <div class="team-head" style="--c:${p.color}">${avatar(p)}<div><div class="nm">${esc(p.name)}</div>
      <div class="muted xs">${p.id === me()?.id ? 'Twoja drużyna' : `${ids.length}/${TEAM_SIZE} zawodników`}</div></div><span class="spacer"></span>
      ${drafting ? '' : `<div class="tot"><div class="v">${hasRes ? calc.byWeekend[w.id]?.[p.id] || 0 : calc.totals[p.id]}</div><div class="l">${hasRes ? 'weekend' : 'sezon'}</div></div>`}</div>
    <div class="team-body">
      ${drafting ? (ids.map((id) => line(id, true)).join('') || '<div class="muted small" style="padding:.6rem 0">Jeszcze nikogo nie wybrano</div>') : `
      ${editable ? `<div class="hint">${icon('info')}<span>Kliknij <b class="capdot">C</b>, by wybrać kapitana (×2). Przyciskiem <b>Wstaw</b> wprowadzasz rezerwowego do składu.</span></div>` : ''}
      <div class="sect">Mężczyźni<span class="sect-r">${label}</span></div>${men.map((id) => line(id, true)).join('')}
      <div class="sect">Kobieta</div>${women.map((id) => line(id, true)).join('')}
      <div class="sect">Rezerwowi</div>${reserves.map((id) => line(id, false)).join('') || '<div class="muted small">—</div>'}
      ${!l.captain ? (editable ? `<div class="warnline">${icon('info')}Nie masz kapitana na ten weekend</div>` : '<div class="muted xs" style="margin-top:.6rem">Bez kapitana na ten weekend</div>') : ''}
      ${tripleBox(p, w, (p.id === me()?.id || isAdmin()) && ids.length === TEAM_SIZE)}
`}
    </div></div>`;
}

// Mnożnik ×3 – raz w sezonie na wybrany konkurs (nie kwalifikacje).
function tripleBox(p, w, editable) {
  const used = state.triples?.[p.id];
  const uw = used && weekends.find((x) => x.races.some((r) => r.id === used));
  const ur = uw?.races.find((r) => r.id === used);
  const label = (r) => `${raceLabel(r)} · ${esc(r.place)} · ${fmtDow(r.date)}`;
  if (ur && raceStarted(ur) && !isAdmin()) {
    const v = calc.byRace[used]?.[p.id]?.total;
    return `<div class="triple used"><div class="th">${icon('star')}Mnożnik ×${TRIPLE} wykorzystany</div><div class="tv">${label(ur)}${v != null ? ` · <b>${v > 0 ? '+' : ''}${v} pkt</b>` : ''}</div></div>`;
  }
  if (!editable) {
    return ur ? `<div class="triple on"><div class="th">${icon('star')}Mnożnik ×${TRIPLE} ustawiony</div><div class="tv">${label(ur)}</div></div>`
      : `<div class="triple"><div class="th">${icon('star')}Mnożnik ×${TRIPLE} jeszcze niewykorzystany</div></div>`;
  }
  const races = w.races.filter((r) => canTriple(r) && (!raceStarted(r) || isAdmin() || r.id === used));
  if (!races.length) {
    if (ur) return `<div class="triple on"><div class="th">${icon('star')}Mnożnik ×${TRIPLE} ustawiony</div><div class="tv">${label(ur)}</div></div>`;
    return w.champ ? `<div class="triple"><div class="th">${icon('star')}Mnożnika ×${TRIPLE} nie można użyć na MŚ</div></div>` : '';
  }
  return `<div class="triple ${ur && uw === w ? 'on' : ''}"><div class="th">${icon('star')}Mnożnik ×${TRIPLE}<span class="muted xs" style="font-weight:600">raz w sezonie · do startu konkursu</span></div>
    <select data-action="triple" data-p="${p.id}"><option value="">${ur && uw !== w ? '— ustawiony na inny weekend —' : '— nie używam w tym weekendzie —'}</option>
      ${races.map((r) => `<option value="${r.id}" ${r.id === used ? 'selected' : ''}>${label(r)}</option>`).join('')}</select>
    ${ur && uw !== w ? `<div class="xs muted">Obecnie: ${label(ur)}. Wybór tutaj go przeniesie.</div>` : ''}</div>`;
}

// ================================================================ kalendarz

function kalendarz() {
  const cur = currentWeekend();
  const ps = state.participants;
  return `<div class="page-head"><div><h1>Kalendarz</h1><div class="sub">Puchar Świata ${seasonLabel(calendar.season)} · ${weekends.length} weekendów · godziny czasu polskiego · kliknij konkurs z wynikami, by zobaczyć szczegóły</div></div></div>
  ${weekends.map((w) => {
    const st = weekendStatus(w);
    const hasRes = w.races.some((r) => results[r.id]);
    const d = new Date(w.start + 'T12:00:00');
    const wpts = ps.map((p) => calc.byWeekend[w.id][p.id]);
    const wmax = Math.max(0, ...wpts);
    return `<div class="card wk ${w.champ ? 'champ' : ''} ${st === 'live' ? 'live' : w === cur && st === 'next' ? 'next' : ''}" id="w-${w.id}">
      <div class="date"><div class="dd">${d.getDate()}${w.end !== w.start ? `<span style="font-size:.7em">–${new Date(w.end + 'T12:00:00').getDate()}</span>` : ''}</div>
        <div class="mm">${d.toLocaleDateString('pl-PL', { month: 'short' }).replace('.', '')}</div><div class="no">#${w.no}</div></div>
      <div class="body">
        <div class="wh">${w.events.map((e) => `<span class="row nowrap" style="gap:.4rem">${flag(e.nation)}<span class="t">${esc(e.place)}</span></span>`).join('<span class="muted">·</span>')}
          ${w.champ ? champTag() : ''}
          ${st === 'live' ? '<span class="tag warn live">trwa</span>' : st === 'past' ? '<span class="tag">zakończony</span>' : w === cur ? `<span class="tag acc">${inDays(daysTo(w.start))}</span>` : ''}
          <span class="spacer"></span>
          ${hasRes && ps.length ? `<div class="chips">${ps.map((p, i) => `<span class="chip ${wpts[i] === wmax && wmax > 0 ? 'top' : ''}">${avatar(p, 'sm')}<b>${wpts[i]}</b></span>`).join('')}</div>` : ''}
        </div>
        <div class="races">${w.races.map((r) => {
          const res = results[r.id];
          const win = res?.results.find((x) => x.rank === 1);
          const tag = res ? 'a' : 'div';
          const live = !res && !r.cancelled && r.date === today();
          return `<${tag} class="race ${res ? 'has-res' : ''} ${r.cancelled ? 'off' : ''} ${r.category === 'QUA' ? 'qua' : ''}" ${res ? `href="#race/${r.id}" title="Zobacz wyniki i punkty"` : ''}>
            <span class="when">${fmtDow(r.date)}<b>${r.time ? localTime(r) : 'godz. —'}</b></span>
            <span class="what"><span class="g ${r.gender === 'W' ? 'w' : ''}">${r.gender === 'W' ? 'K' : 'M'}</span>
              <span class="l">${raceLabel(r)}</span><span class="h">${r.champ ? `<b class="champ-ink">MŚ</b> · ` : ''}${esc(r.place)} · skocznia ${hillShort(r.discipline)}${r.cancelled ? ' · odwołany' : ''}${r.champ && !countsForLeague(r, state.settings) ? ' · nie liczy się do ligi' : ''}</span>
              ${win ? `<span class="win">· ${flag(win.nation)}${esc(prettyName(win.name).last)}</span>` : ''}</span>
            <span class="chips">${res && ps.length ? ps.map((p) => {
              const v = calc.byRace[r.id]?.[p.id]?.total || 0;
              return v ? `<span class="chip">${avatar(p, 'sm')}<b>+${v}</b></span>` : '';
            }).join('') : ''}</span>
            ${res ? `<span class="go">Wyniki${icon('chevron')}</span>`
              : `<span class="soon">${r.cancelled ? 'odwołany' : live ? 'dziś' : st === 'past' ? 'brak wyników' : 'wyniki po konkursie'}</span>`}
          </${tag}>`;
        }).join('')}</div>
      </div></div>`;
  }).join('')}`;
}

function raceView(id) {
  const w = weekends.find((x) => x.races.some((r) => r.id === id));
  const race = w?.races.find((r) => r.id === id);
  const res = results[id];
  if (!race || !res) return `<a class="back" href="#kalendarz">${icon('back')}Kalendarz</a><div class="card empty">${icon('calendar')}<b>Brak wyników</b>Ten konkurs jeszcze się nie odbył.</div>`;
  const records = recordIds(state, id, res);
  const pts = racePoints(race, res, state.settings, records);
  const hr = res.hillRecord;
  const lj = race.category === 'WC' ? longestJump(res) : 0;
  const lineups = Object.fromEntries(state.participants.map((p) => [p.id, lineupFor(state, weekends, w.id, p.id, calc.teams[p.id] || [], byId)]));
  const ownerInfo = (aid) => {
    const pid = ownerOf(aid);
    if (!pid) return '';
    const l = lineups[pid];
    const starter = l.starters.includes(aid);
    return owner(pid, `${l.captain === aid ? ' <span class="cap">C</span>' : ''}${starter ? '' : ' <span class="muted xs">(rez.)</span>'}`);
  };
  const sorted = [...res.results].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const ps = [...state.participants].sort((a, b) => (calc.byRace[id]?.[b.id]?.total || 0) - (calc.byRace[id]?.[a.id]?.total || 0));
  const m = me();

  return `<a class="back" href="#kalendarz">${icon('back')}Kalendarz</a>
    <div class="hero race-hero ${race.champ ? 'champ' : ''}">${MOUNTAINS}
      <div class="eyebrow">Weekend ${w.no} · ${race.champ ? `${CHAMP} ${calendar.season}${race.category === 'QUA' ? ' · kwalifikacje' : ''}` : race.category === 'QUA' ? 'kwalifikacje' : 'Puchar Świata'}</div>
      <div class="big">${raceLabel(race)} — ${esc(race.place)}</div>
      <div class="meta"><span>${icon('calendar')}${fmtLong(race.date)}${race.time ? `, ${localTime(race)} (czasu polskiego)` : ''}</span><span>${flag(race.nation)}skocznia ${hillShort(race.discipline)}</span>
        ${lj ? `<span>${icon('ruler')}najdłuższy skok: <b>${lj} m</b></span>` : ''}
        ${hr ? `<span>${icon('star')}rekord skoczni: <b>${hr.distance} m</b>${records.length ? ' — <b>POBITY!</b>' : ''}</span>` : ''}
        <span><a href="https://www.fis-ski.com/DB/general/results.html?sectorcode=JP&raceid=${id}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">wyniki FIS ↗</a></span></div>
    </div>
    ${!countsForLeague(race, state.settings) ? `<div class="warnline" style="margin-top:1rem">${icon('info')}Mistrzostwa Świata nie liczą się do punktacji ligi (ustawienie admina).</div>` : ''}
    ${ps.length && countsForLeague(race, state.settings) ? `<div class="section grid">${ps.map((p) => {
      const e = calc.byRace[id]?.[p.id] || { total: 0, athletes: [], penalty: 0 };
      return `<div class="card team"><div class="team-head" style="--c:${p.color}">${avatar(p)}<div class="nm">${esc(p.name)}</div><span class="spacer"></span>
          <div class="tot"><div class="v">+${e.total}</div><div class="l">pkt</div></div></div>
        <div class="team-body">${e.triple ? `<div class="triple on" style="margin:.6rem 0 .2rem">${icon('star')}<span>Mnożnik ×${TRIPLE} — wszystkie punkty potrojone</span></div>` : ''}
          ${e.athletes.sort((a, b) => b.pts - a.pts).map((a) => `<div class="player">${ath(a.id, { gender: false, photo: true })}
          ${a.captain ? '<span class="cap">C</span>' : ''}<span class="pp">${a.pts}</span></div>
          <div class="muted xs" style="margin:-.35rem 0 .3rem;text-align:right">${breakdown(a.base)}${a.captain ? ' · ×2 kapitan' : ''}</div>`).join('') || '<div class="muted small" style="padding:.6rem 0">Brak punktów w tym konkursie</div>'}
          ${e.penalty ? `<div class="player"><span class="ath"><span class="ph ini bad">!</span><span class="nm">Kapitan poza top 30</span></span><span class="pp" style="color:var(--bad)">${e.penalty}</span></div>` : ''}</div></div>`;
    }).join('')}</div>` : ''}
    <div class="section"><div class="row"><h2>Wyniki</h2><span class="spacer"></span>
      ${isAdmin() ? `<button class="sm" data-action="editRecord">${icon(ui.editRecord ? 'check' : 'star')}${ui.editRecord ? 'Gotowe' : 'Popraw rekord skoczni'}</button>` : ''}</div>
    ${records.length ? `<div class="warnline champline" style="margin:0 0 .8rem">${icon('star')}Nowy rekord skoczni: ${records.map((rid) => esc(prettyName(athInfo(rid, res.results.find((x) => x.id === rid)).name).last)).join(', ')} (+${scoringSettings(state.settings).bonus.record} pkt)</div>` : ''}
    ${ui.editRecord ? `<div class="warnline" style="margin:0 0 .8rem">${icon('info')}Rekord wykrywany jest automatycznie z protokołu FIS. Tu możesz go poprawić, np. gdy skok z upadkiem nie został uznany.
      ${Array.isArray(state.hillRecords?.[id]) ? `<button class="sm" data-action="recordAuto" data-race="${id}">Przywróć automatyczne</button>` : ''}</div>` : ''}
    <div class="card pad0"><div class="tablewrap"><table>
      <thead><tr><th class="num">Msc</th><th>Zawodnik</th><th class="num">${race.category === 'WC' ? 'Skoki' : 'Odl.'}</th><th class="num hide-sm">Nota</th><th class="num">Pkt ligi</th><th>Drużyna</th>${ui.editRecord ? '<th>Rekord</th>' : ''}</tr></thead>
      <tbody>${sorted.map((r) => {
        const p = pts.get(r.id);
        const mine = m && ownerOf(r.id) === m.id;
        return `<tr class="${mine ? 'mine' : ''}">
          <td class="rank">${r.rank ? (r.rank <= 3 ? `<span class="medal m${r.rank}">${r.rank}</span>` : r.rank) : '<span class="tag bad">DSQ</span>'}</td>
          <td>${ath(r.id, { fallback: { ...r, gender: race.gender }, gender: false, photo: true })}</td>
          <td class="num">${r.jumps.map((j) => (j === lj ? `<span class="longest">${j}</span>` : j)).join('<span class="muted"> / </span>')}</td>
          <td class="num hide-sm muted">${r.total ?? ''}</td>
          <td class="pts">${p?.total ? `${p.quali ? '<span class="bonus">wygrane kwal.</span>' : ''}${p.longest ? '<span class="bonus">najdłuższy</span>' : ''}${p.record ? '<span class="bonus gold">rekord</span>' : ''} ${p.total}` : ''}</td>
          <td>${ownerInfo(r.id)}</td>
          ${ui.editRecord ? `<td><input type="checkbox" data-action="record" data-race="${id}" data-id="${r.id}" ${records.includes(r.id) ? 'checked' : ''}></td>` : ''}
        </tr>`;
      }).join('')}</tbody></table></div></div>
    <p class="muted xs" style="margin-top:.6rem">„Pkt ligi” — punkty zawodnika w tym konkursie, bez kapitana i mnożnika. ${m ? 'Podświetlone wiersze to Twoi zawodnicy. ' : ''}Zielona odległość = najdłuższy skok konkursu.</p></div>`;
}

function breakdown(b) {
  const parts = [];
  if (b.place) parts.push(`miejsce +${b.place}`);
  if (b.quali) parts.push(`kwal. +${b.quali}`);
  if (b.longest) parts.push(`najdł. skok +${b.longest}`);
  if (b.record) parts.push(`rekord +${b.record}`);
  return parts.join(' · ');
}

// ================================================================ puchar świata

function puchar() {
  const g = ui.wcGender;
  const prev = ui.wcSeason === 'previous';
  let rows; let note = '';
  if (prev) {
    rows = standings?.previous?.[g] || [];
    note = `Końcowa klasyfikacja sezonu ${seasonLabel(calendar.season - 1)} (FIS)`;
  } else {
    const s = wcStandings(weekends, results, g);
    rows = s.rows;
    note = s.races ? `Po ${s.races} ${pl(s.races, 'konkursie', 'konkursach', 'konkursach')} · liczona z oficjalnych wyników FIS` : 'Sezon jeszcze się nie zaczął';
  }
  const lead = rows[0]?.points || 0;
  const m = me();
  return `<div class="page-head"><div><h1>Puchar Świata</h1><div class="sub">Klasyfikacja generalna · ${note}</div></div></div>
    <div class="row" style="margin-bottom:1rem">
      <div class="seg">${[['M', 'Mężczyźni'], ['W', 'Kobiety']].map(([k, l]) => `<button data-action="wcGender" data-v="${k}" class="${g === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg">${[['current', `Sezon ${seasonLabel(calendar.season)}`], ['previous', seasonLabel(calendar.season - 1)]].map(([k, l]) => `<button data-action="wcSeason" data-v="${k}" class="${ui.wcSeason === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    ${rows.length ? `<div class="card pad0"><div class="tablewrap"><table>
      <thead><tr><th class="num">Msc</th><th>Zawodnik</th><th class="num">Pkt</th><th class="num hide-sm">Strata</th><th>W lidze</th></tr></thead>
      <tbody>${rows.map((r) => {
        const o = ownerOf(r.id);
        return `<tr class="${m && o === m.id ? 'mine' : ''}">
          <td class="rank">${r.rank <= 3 ? `<span class="medal m${r.rank}">${r.rank}</span>` : r.rank}</td>
          <td>${ath(r.id, { fallback: { ...r, gender: g }, gender: false, photo: true })}</td>
          <td class="pts">${r.points}</td>
          <td class="num hide-sm muted">${r.points === lead ? '' : `−${lead - r.points}`}</td>
          <td>${o ? owner(o) : '<span class="muted xs">wolny</span>'}</td></tr>`;
      }).join('')}</tbody></table></div></div>`
      : `<div class="card empty">${icon('globe')}<b>Klasyfikacja ruszy po pierwszym konkursie</b>
         ${weekends[0] ? `Start sezonu: ${esc(weekends[0].name)}, ${fmtLong(weekends[0].start)}.` : ''}
         <div style="margin-top:1rem"><button data-action="wcSeason" data-v="previous">Pokaż sezon ${seasonLabel(calendar.season - 1)}</button></div></div>`}`;
}

// ================================================================ zawodnicy

function zawodnicy() {
  const raw = {};
  for (const w of weekends) for (const r of w.races) {
    if (!results[r.id] || !countsForLeague(r, state.settings)) continue;
    for (const [id, p] of racePoints(r, results[r.id], state.settings, recordIds(state, r.id, results[r.id]))) raw[id] = (raw[id] || 0) + p.total;
  }
  const q = ui.q.toLowerCase();
  const list = athletes.filter((a) => (ui.gender === 'ALL' || a.gender === ui.gender) && (!q || `${a.name} ${a.nation}`.toLowerCase().includes(q)))
    .sort((a, b) => (raw[b.id] || 0) - (raw[a.id] || 0) || byId[a.id].idx - byId[b.id].idx);
  return `<div class="page-head"><div><h1>Zawodnicy</h1><div class="sub">Ile punktów ligi zdobywa każdy skoczek — także ci, których nikt nie wybrał</div></div></div>
    <div class="row" style="margin-bottom:.8rem">${genderSeg()}
      <label class="search">${icon('search')}<input id="q" placeholder="Szukaj zawodnika lub kraju" value="${esc(ui.q)}"></label></div>
    <div class="card pad0"><div class="tablewrap"><table>
      <thead><tr><th>Zawodnik</th><th class="num" title="Punkty ligi bez kapitana, niezależnie od składu">Pkt sezonu</th><th class="num hide-sm" title="Punkty zdobyte dla drużyny (tylko w składzie, z kapitanem)">Dla drużyny</th><th class="num hide-sm">PŚ ${seasonLabel(athSeason - 1)}</th><th>Drużyna</th></tr></thead>
      <tbody>${list.map((a) => `<tr><td>${ath(a.id, { photo: true })}</td><td class="pts">${raw[a.id] || 0}</td>
        <td class="num hide-sm">${calc.athleteTotals[a.id] || '<span class="muted">–</span>'}</td>
        <td class="num hide-sm muted">${a.wc || '–'}</td><td>${owner(ownerOf(a.id))}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

// ================================================================ zasady

function zasady() {
  const c = scoringSettings(state?.settings || {});
  const champsOn = state?.settings?.countChamps !== false;
  const pts = c.placePoints;
  const sec = (title, ic, body) => `<div class="card"><div class="row" style="margin-bottom:.6rem">${icon(ic)}<h3>${title}</h3></div>${body}</div>`;
  const li = (items) => `<ul class="rules">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  return `<div class="page-head"><div><h1>Zasady</h1><div class="sub">Wszystko, co trzeba wiedzieć o lidze — wartości aktualne dla tej ligi</div></div></div>
  <div class="grid-2">
    <div class="stack">
      ${sec('Drużyna i draft', 'team', li([
        `Każdy gracz ma <b>${TEAM_SIZE} zawodników</b>: ${TEAM.men} mężczyzn i ${TEAM.women} kobietę w składzie + ${TEAM.reserves} rezerwowych (dowolnej płci).`,
        'Draft metodą <b>snake</b>: kolejność 1–2–3, potem 3–2–1 i tak na zmianę.',
        'Każdy zawodnik może trafić tylko do jednej drużyny. Do wyboru są wszyscy aktywni skoczkowie z bazy FIS.',
        'Punkty zdobywają tylko zawodnicy ze składu — rezerwowi nie. Przed każdym weekendem możesz wstawić rezerwowego za zawodnika tej samej płci.',
      ]))}
      ${sec('Kapitan', 'star', li([
        'Przed każdym weekendem wybierasz <b>kapitana</b> spośród zawodników w składzie.',
        'Kapitan zdobywa <b>×2</b> punkty za wszystko w danym weekendzie.',
        `<b>Kara −${c.penalty} pkt</b>, gdy kapitan skończy konkurs poza czołową 30 — także gdy odpadnie w kwalifikacjach lub nie wystartuje. Dotyczy konkursów jego płci (PŚ i MŚ), nie kwalifikacji.`,
        'Kapitana nie można zmienić w trakcie weekendu; w każdym weekendzie może być inny.',
      ]))}
      ${sec(`Mnożnik ×${TRIPLE}`, 'star', li([
        `<b>Raz w sezonie</b> wybierasz jeden konkurs, w którym wszystkie punkty Twojej drużyny są mnożone <b>×${TRIPLE}</b> (razem z kapitanem i karą).`,
        'Tylko konkursy Pucharu Świata — nie działa na kwalifikacje ani na Mistrzostwa Świata.',
        'Można go ustawić lub zmienić <b>do startu wybranego konkursu</b> (zakładka Drużyny). Potem jest wykorzystany.',
      ]))}
      ${sec('Terminy', 'clock', li([
        'Skład i kapitan blokują się <b>minutę przed startem pierwszych kwalifikacji weekendu</b> (godzina z FIS; dopóki FIS jej nie poda — o północy przed pierwszym dniem).',
        'Weekend to zawody mężczyzn i kobiet rozgrywane w tych samych dniach (np. Ruka + Hinzenbach).',
        'Mistrzostwa Świata trwają dwa weekendy — to dwie osobne rundy z osobnym kapitanem.',
      ]))}
    </div>
    <div class="stack">
      ${sec('Punkty za miejsce — Puchar Świata', 'trophy', `<p class="small muted" style="margin-bottom:.6rem">Jak w klasyfikacji PŚ FIS:</p>
        <div class="ptsgrid">${pts.map((v, i) => `<span><b>${i + 1}.</b> ${v}</span>`).join('')}</div>`)}
      ${sec('Mistrzostwa Świata', 'star', `${li([
        `🥇 Złoto <b>${c.champ.gold}</b> · 🥈 Srebro <b>${c.champ.silver}</b> · 🥉 Brąz <b>${c.champ.bronze}</b>`,
        `Miejsca 4–10: <b>${c.champ.top10}</b> pkt`,
        'Bonusy, kapitan i kara za kapitana poza top 30 działają tak samo jak w PŚ. <b>Mnożnika ×3 na MŚ nie można użyć.</b>',
      ])}${champsOn ? '' : '<div class="warnline">W tej lidze MŚ nie liczą się do punktacji (ustawienie admina).</div>'}`)}
      ${sec('Bonusy', 'ruler', `${li([
        `Zwycięstwo w kwalifikacjach: <b>+${c.bonus.quali}</b>`,
        `Najdłuższy skok konkursu: <b>+${c.bonus.longest}</b> — tylko konkurs główny (wszystkie serie); przy remisie obaj dostają punkty.`,
        `Rekord skoczni: <b>+${c.bonus.record}</b> — w konkursie i w kwalifikacjach. Wyrównanie rekordu się nie liczy.`,
        'Bonusy sumują się z punktami za miejsce.',
      ])}`)}
      ${sec('Kwalifikacje', 'list', li([
        'W kwalifikacjach <b>nie ma punktów za miejsce</b>.',
        `Liczy się tylko zwycięzca kwalifikacji (+${c.bonus.quali}) i rekord skoczni (+${c.bonus.record}).`,
      ]))}
      ${sec('Skąd są wyniki', 'globe', li([
        'Wyniki i odległości pobierane są automatycznie z oficjalnych danych FIS (co 2 h, w weekendy co 30 min).',
        'Godziny startu: z Berkutschi (gdy opublikuje program zawodów), a wcześniej z programów zawodów FIS. W aplikacji zawsze w czasie polskim.',
        'Rekord skoczni odczytywany jest z oficjalnego protokołu FIS; admin może go poprawić, jeśli skok nie został uznany.',
        'Liczą się tylko konkursy indywidualne — bez drużynówek, duetów i mikstów.',
      ]))}
    </div>
  </div>`;
}

// ================================================================ więcej (telefon)

function wiecej() {
  const items = [['zasady', 'Zasady', 'info'], ['draft', 'Draft', 'draft'], ['zawodnicy', 'Zawodnicy', 'list'], ['puchar', 'Puchar Świata', 'globe']];
  if (isAdmin()) items.push(['admin', 'Panel admina', 'settings']);
  return `<div class="page-head"><h1>Więcej</h1></div>
    <div class="card menu" style="position:static;box-shadow:none;min-width:0">
      ${items.map(([k, l, i]) => `<a href="#${k}">${icon(i)}${l}</a>`).join('')}
      <hr>
      ${me() ? `<button data-action="changePin">${icon('key')}Zmień PIN</button>` : `<button data-action="joinAsAdmin">${icon('plus')}Dołącz jako gracz</button>`}
      ${isAdmin() ? `<button data-action="adminOff">${icon('lock')}Wyjdź z trybu admina</button>` : `<button data-action="adminOn">${icon('unlock')}Tryb administratora</button>`}
      <button data-action="logout">${icon('logout')}Wyloguj</button>
    </div>`;
}

// ================================================================ admin

function adminView() {
  const ph = phase();
  const s = state.settings;
  const bonus = { ...DEFAULT_BONUS, ...(s.bonus || {}) };
  const cfg = scoringSettings(s);
  const total = state.draftOrder.length * TEAM_SIZE;
  return `<div class="page-head"><div><h1>Panel admina</h1><div class="sub">${esc(state.setup.leagueName)} · ${ph === 'signup' ? 'zapisy otwarte' : ph === 'draft' ? `draft w toku (${state.picks.length}/${total})` : 'sezon trwa'}</div></div></div>
  <div class="grid-2">
    <div class="stack">
      <div class="card">
        <div class="row" style="margin-bottom:.6rem"><h3>Gracze i kolejność draftu</h3><span class="spacer"></span>
          ${ph === 'signup' ? `<button class="sm" data-action="shuffle" ${state.draftOrder.length < 2 ? 'disabled' : ''}>${icon('shuffle')}Losuj</button>` : ''}</div>
        ${state.draftOrder.map((pid, i) => {
          const p = P(pid);
          return `<div class="player"><b class="muted" style="width:1.2rem">${i + 1}.</b>${avatar(p, 'sm')}<span class="ath"><span class="nm">${esc(p.name)}</span></span>
            ${p.id === session.pid ? '<span class="tag acc">Ty</span>' : ''}<span class="spacer"></span>
            ${ph === 'signup' ? `<button class="icon ghost" data-action="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="W górę">▲</button>
              <button class="icon ghost" data-action="down" data-i="${i}" ${i === state.draftOrder.length - 1 ? 'disabled' : ''} title="W dół">▼</button>` : ''}
            <button class="icon ghost" data-action="resetPin" data-id="${p.id}" title="Ustaw nowy PIN">${icon('key')}</button>
            ${ph === 'signup' ? `<button class="icon ghost danger" data-action="removeP" data-id="${p.id}" title="Usuń">${icon('trash')}</button>` : ''}
          </div>`;
        }).join('') || '<div class="muted small">Nikt jeszcze nie dołączył. Wyślij znajomym link do strony.</div>'}
        <div class="row" style="margin-top:1rem">
          <button class="sm" data-action="addP">${icon('plus')}Dodaj gracza</button>
          ${!me() ? `<button class="sm" data-action="joinAsAdmin">${icon('user')}Dołącz sam jako gracz</button>` : ''}
        </div>
      </div>
      <div class="card">
        <h3 style="margin-bottom:.4rem">Draft</h3>
        ${ph === 'signup' ? `<p class="muted small" style="margin-bottom:1rem">Rozpoczęcie draftu zamyka zapisy. Kolejność jak na liście powyżej (snake: 1→${state.draftOrder.length || 'N'}, potem z powrotem).</p>
          <button class="primary" data-action="startDraft" ${state.draftOrder.length < 2 ? 'disabled' : ''}>${icon('play')}Rozpocznij draft</button>`
        : `<p class="muted small" style="margin-bottom:1rem">${ph === 'draft' ? `Wybrano ${state.picks.length} z ${total}.` : 'Draft zakończony.'} Jako admin możesz wybierać za innych w zakładce Draft.</p>
          <div class="row"><button data-action="undo" ${state.picks.length ? '' : 'disabled'}>${icon('undo')}Cofnij ostatni wybór</button>
          <button class="danger" data-action="resetDraft">${icon('trash')}Zresetuj draft</button></div>`}
      </div>
    </div>
    <div class="stack">
      <div class="card">
        <h3 style="margin-bottom:.3rem">Punktacja</h3>
        <p class="muted small" style="margin-bottom:.8rem">Punkty za miejsca 1, 2, 3… (domyślnie punktacja PŚ FIS). Zmiana przelicza cały sezon.</p>
        <label class="field"><span>Punkty za miejsca</span><textarea id="placePts">${(s.placePoints || FIS_POINTS).join(', ')}</textarea></label>
        <div class="grid-3" style="gap:.6rem">
          <label class="field"><span>Wygrane kwalifikacje</span><input id="bQ" type="number" value="${bonus.quali}"></label>
          <label class="field"><span>Najdłuższy skok</span><input id="bL" type="number" value="${bonus.longest}"></label>
          <label class="field"><span>Rekord skoczni</span><input id="bR" type="number" value="${bonus.record}"></label>
        </div>
        <div class="grid-3" style="gap:.6rem">
          <label class="field"><span>Kara: kapitan poza top 30</span><input id="pen" type="number" value="${cfg.penalty}"></label>
        </div>
        <label class="field"><span>Mistrzostwa Świata — złoto, srebro, brąz, miejsca 4–10</span>
          <div class="grid-3" style="gap:.6rem;grid-template-columns:repeat(4,1fr)">
            <input id="cG" type="number" value="${cfg.champ.gold}" title="Złoto"><input id="cS" type="number" value="${cfg.champ.silver}" title="Srebro">
            <input id="cB" type="number" value="${cfg.champ.bronze}" title="Brąz"><input id="cT" type="number" value="${cfg.champ.top10}" title="Miejsca 4–10"></div></label>
        <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="countChamps" ${s.countChamps !== false ? 'checked' : ''}>Mistrzostwa Świata liczą się do punktacji ligi (tak samo jak konkursy PŚ, z kapitanem i bonusami)</label>
        <div class="row"><button class="primary" data-action="saveScoring">${icon('check')}Zapisz</button><button class="ghost" data-action="resetScoring">Przywróć domyślne</button></div>
      </div>
      <div class="card">
        <h3 style="margin-bottom:.8rem">Liga</h3>
        <div class="row"><button data-action="renameLeague">Zmień nazwę</button><button data-action="changeAdminPass">${icon('key')}Zmień hasło admina</button></div>
      </div>
      <div class="card">
        <h3 style="margin-bottom:.3rem">Kopia zapasowa</h3>
        <p class="muted small" style="margin-bottom:.8rem">Zapisz stan ligi (gracze, draft, składy) do pliku — na wszelki wypadek.</p>
        <div class="row"><button data-action="export">${icon('download')}Pobierz</button>
          <label class="btn">${icon('upload')}Wczytaj z pliku<input type="file" id="importFile" accept=".json" hidden></label>
          <span class="spacer"></span><button class="danger" data-action="deleteLeague">${icon('trash')}Usuń ligę</button></div>
      </div>
    </div>
  </div>`;
}

// ================================================================ akcje

function setSession(s) { session = s; LS.set(SESSION_KEY, s); }

function newParticipant(s, name, pinHash) {
  const n = name.trim();
  if (!n) fail('Podaj imię');
  if (s.participants.some((p) => p.name.toLowerCase() === n.toLowerCase())) fail('Ktoś o tym imieniu już jest w lidze');
  const used = new Set(s.participants.map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[s.participants.length % COLORS.length];
  const p = { id: 'p' + randomId(6), name: n, pinHash, color, joined: new Date().toISOString() };
  s.participants.push(p);
  s.draftOrder.push(p.id);
  return p;
}

const forms = {
  async create(f, err) {
    if (f.pass !== f.pass2) return err('Hasła się różnią');
    const salt = randomId(12);
    const adminHash = await hash(salt, f.pass);
    const ok = await save((s) => {
      if (s.setup) fail('Liga została już otwarta');
      s.setup = { leagueName: f.league.trim(), salt, adminHash, created: new Date().toISOString() };
      return s;
    });
    if (ok) { setSession({ adminHash }); location.hash = '#admin'; render(); toast('Liga otwarta! Teraz dołącz jako gracz i wyślij link znajomym.', 'ok'); }
  },
  async join(f, err) {
    if (!/^\d{4,8}$/.test(f.pin)) return err('PIN musi mieć 4–8 cyfr');
    if (f.pin !== f.pin2) return err('PINy się różnią');
    const pinHash = await hash(state.setup.salt, f.pin);
    let created;
    try {
      await store.update((s) => {
        if (s.draftStarted) fail('Draft już się zaczął — zapisy są zamknięte');
        created = newParticipant(s, f.name, pinHash);
        return s;
      });
    } catch (e) { return err(e.message); }
    setSession({ ...session, pid: created.id, pinHash });
    ui.authMode = null;
    render();
    toast(`Witaj w lidze, ${created.name}!`, 'ok');
  },
  async login(f, err) {
    const p = P(f.pid);
    const h = await hash(state.setup.salt, f.pin);
    if (!p || p.pinHash !== h) return err('Zły PIN');
    setSession({ ...session, pid: p.id, pinHash: h });
    render();
  },
  async adminLogin(f, err) {
    const h = await hash(state.setup.salt, f.pass);
    if (h !== state.setup.adminHash) return err('Złe hasło');
    setSession({ ...session, adminHash: h });
    ui.authMode = null;
    render();
  },
};

const actions = {
  menu: () => { ui.menu = !ui.menu; ui.navMore = false; render(); },
  navMore: () => { ui.navMore = !ui.navMore; ui.menu = false; render(); },
  authMode: (el) => { ui.authMode = el.dataset.v || null; render(); },
  logout: async () => {
    if (await confirmModal('Wylogować?', 'Do ponownego zalogowania potrzebny będzie PIN.', 'Wyloguj')) { setSession({}); ui.menu = false; location.hash = ''; render(); }
  },
  adminOff: () => { setSession({ ...session, adminHash: null }); ui.menu = false; if (!me()) location.hash = ''; render(); },
  adminOn: async () => {
    ui.menu = false; render();
    const v = await modal({ title: 'Tryb administratora', fields: [{ name: 'pass', label: 'Hasło administratora', type: 'password' }], ok: 'Odblokuj' });
    if (!v) return;
    const h = await hash(state.setup.salt, v.pass);
    if (h !== state.setup.adminHash) return toast('Złe hasło', 'err');
    setSession({ ...session, adminHash: h }); render(); toast('Tryb administratora włączony', 'ok');
  },
  joinAsAdmin: async () => {
    ui.menu = false; render();
    const v = await modal({ title: 'Dołącz jako gracz', text: 'Wpisz imię i PIN (4–8 cyfr) — będziesz w lidze tak jak pozostali.', ok: 'Dołącz',
      fields: [{ name: 'name', label: 'Imię', attrs: 'maxlength="20" required' }, { name: 'pin', label: 'PIN', type: 'password', attrs: 'inputmode="numeric" pattern="[0-9]{4,8}" required' }] });
    if (!v) return;
    const pinHash = await hash(state.setup.salt, v.pin);
    let created;
    const ok = await save((s) => { if (s.draftStarted) fail('Draft już trwa — dodaj gracza przed draftem'); created = newParticipant(s, v.name, pinHash); return s; });
    if (ok) { setSession({ ...session, pid: created.id, pinHash }); render(); toast(`Dołączono jako ${created.name}`, 'ok'); }
  },
  changePin: async () => {
    ui.menu = false; render();
    const v = await modal({ title: 'Zmień PIN', fields: [{ name: 'old', label: 'Obecny PIN', type: 'password', attrs: 'inputmode="numeric" required' },
      { name: 'pin', label: 'Nowy PIN (4–8 cyfr)', type: 'password', attrs: 'inputmode="numeric" pattern="[0-9]{4,8}" required' }], ok: 'Zapisz' });
    if (!v) return;
    const m = me();
    if (await hash(state.setup.salt, v.old) !== m.pinHash) return toast('Zły obecny PIN', 'err');
    const pinHash = await hash(state.setup.salt, v.pin);
    if (await save((s) => { s.participants.find((p) => p.id === m.id).pinHash = pinHash; return s; }, 'PIN zmieniony')) setSession({ ...session, pinHash });
  },

  gender: (el) => { ui.gender = el.dataset.v; ui.limit = 150; render(); },
  more: () => { ui.limit += 150; render(); },
  triple: (el) => {
    const { p } = el.dataset;
    const raceId = el.value;
    save((s) => {
      s.triples = s.triples || {};
      const cur = s.triples[p];
      const find = (id) => weekends.flatMap((x) => x.races).find((r) => r.id === id);
      const cw = cur && weekends.find((x) => x.races.some((r) => r.id === cur));
      if (cur && raceStarted(find(cur)) && !isAdmin()) fail('Mnożnik ×3 został już wykorzystany w tym sezonie');
      if (raceId && raceStarted(find(raceId)) && !isAdmin()) fail('Ten konkurs już się rozpoczął');
      if (raceId && !canTriple(find(raceId))) fail('Mnożnika ×3 nie można użyć na Mistrzostwach Świata ani w kwalifikacjach');
      if (raceId) s.triples[p] = raceId;
      else if (!cw || cw.id === ui.weekend) delete s.triples[p];
      return s;
    }, raceId ? `Mnożnik ×${TRIPLE} ustawiony` : 'Mnożnik ×3 zdjęty');
  },
  recordAuto: (el) => save((s) => { delete s.hillRecords[el.dataset.race]; return s; }, 'Przywrócono automatyczne wykrywanie'),
  hideTaken: (el) => { ui.hideTaken = el.checked; render(); },
  weekend: (el) => { ui.weekend = el.dataset.v; render(); },
  wcGender: (el) => { ui.wcGender = el.dataset.v; render(); },
  wcSeason: (el) => { ui.wcSeason = el.dataset.v; render(); },
  editRecord: () => { ui.editRecord = !ui.editRecord; render(); },

  pick: async (el) => {
    const aid = el.dataset.id;
    const cur = snakeOrder(state.draftOrder)[state.picks.length];
    if (!cur) return;
    const a = athInfo(aid);
    const n = prettyName(a.name);
    const forWho = cur.pid !== me()?.id ? ` dla gracza <b>${esc(pname(cur.pid))}</b>` : '';
    const ok = await confirmModal(`Wybrać ${n.first} ${n.last}?`,
      `<span class="pick-prev">${portrait(a, 'lg')}<span>${flag(a.nation)} ${esc(a.nation)}${a.wc ? ` · PŚ ${seasonLabel(athSeason - 1)}: ${a.wc} pkt` : ''}</span></span>Wybór jest ostateczny${forWho}.`, 'Wybieram');
    if (!ok) return;
    localPick = aid;
    save((s) => {
      const c = snakeOrder(s.draftOrder)[s.picks.length];
      if (!c || c.pid !== cur.pid || s.picks.includes(aid)) fail('Stan draftu się zmienił — spróbuj ponownie');
      s.picks.push(aid);
      return s;
    }, `Wybrano: ${n.first} ${n.last}`);
  },
  undo: async () => {
    if (!state.picks.length) return;
    const last = prettyName(athInfo(state.picks[state.picks.length - 1]).name);
    if (await confirmModal('Cofnąć ostatni wybór?', `${esc(last.first)} ${esc(last.last)} wróci na listę dostępnych.`, 'Cofnij')) {
      save((s) => { s.picks.pop(); return s; });
    }
  },

  captain: (el) => {
    const { p, id } = el.dataset;
    save((s) => setLineup(s, p, (l) => ({ ...l, captain: l.captain === id ? null : id })));
  },
  swap: async (el) => {
    const { p, id } = el.dataset;
    const ids = calc.teams[p] || [];
    const l = lineupFor(state, weekends, ui.weekend, p, ids, byId);
    const inName = prettyName(athInfo(id).name);
    const out = await choose({
      title: `Wstaw: ${inName.first} ${inName.last}`,
      text: 'Za kogo ma wejść do składu?',
      options: l.starters.filter((s) => byId[s]?.gender === byId[id]?.gender)
        .map((s) => ({ value: s, html: `${ath(s, { gender: false, photo: true })}${l.captain === s ? '<span class="cap">C</span>' : ''}` })),
    });
    if (!out) return;
    save((s) => setLineup(s, p, (l) => ({
      starters: l.starters.map((x) => (x === out ? id : x)),
      captain: l.captain === out ? null : l.captain,
    })), 'Skład zmieniony');
  },
  record: (el) => {
    const { race, id } = el.dataset;
    const on = el.checked;
    save((s) => {
      // ręczna poprawka zastępuje automatyczne wykrycie z protokołu FIS
      const cur = new Set(recordIds(s, race, results[race]));
      on ? cur.add(id) : cur.delete(id);
      s.hillRecords[race] = [...cur];
      return s;
    });
  },

  // admin
  addP: async () => {
    const v = await modal({ title: 'Dodaj gracza', text: 'Dla kogoś, kto nie może zapisać się sam. Przekaż mu PIN.', ok: 'Dodaj',
      fields: [{ name: 'name', label: 'Imię', attrs: 'maxlength="20" required' }, { name: 'pin', label: 'PIN (4–8 cyfr)', attrs: 'inputmode="numeric" pattern="[0-9]{4,8}" required' }] });
    if (!v) return;
    const pinHash = await hash(state.setup.salt, v.pin);
    save((s) => { if (s.draftStarted) fail('Draft już trwa'); newParticipant(s, v.name, pinHash); return s; }, `Dodano: ${v.name}`);
  },
  removeP: async (el) => {
    const p = P(el.dataset.id);
    if (!await confirmModal(`Usunąć ${esc(p.name)}?`, 'Gracz zniknie z ligi.', 'Usuń', true)) return;
    save((s) => {
      if (s.draftStarted) fail('Nie można usuwać graczy po starcie draftu');
      s.participants = s.participants.filter((x) => x.id !== p.id);
      s.draftOrder = s.draftOrder.filter((x) => x !== p.id);
      return s;
    });
  },
  resetPin: async (el) => {
    const p = P(el.dataset.id);
    const v = await modal({ title: `Nowy PIN dla ${p.name}`, fields: [{ name: 'pin', label: 'PIN (4–8 cyfr)', attrs: 'inputmode="numeric" pattern="[0-9]{4,8}" required' }], ok: 'Ustaw' });
    if (!v) return;
    const pinHash = await hash(state.setup.salt, v.pin);
    save((s) => { s.participants.find((x) => x.id === p.id).pinHash = pinHash; return s; }, 'PIN zmieniony');
    if (p.id === session.pid) setSession({ ...session, pinHash });
  },
  up: (el) => moveP(+el.dataset.i, -1),
  down: (el) => moveP(+el.dataset.i, 1),
  shuffle: () => save((s) => {
    const o = s.draftOrder;
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    return s;
  }, 'Kolejność wylosowana'),
  startDraft: async () => {
    const names = state.draftOrder.map((pid) => esc(pname(pid))).join(' → ');
    if (!await confirmModal('Rozpocząć draft?', `Kolejność: <b>${names}</b>.<br>Zapisy zostaną zamknięte.`, 'Start')) return;
    if (await save((s) => { if (s.draftOrder.length < 2) fail('Potrzeba co najmniej 2 graczy'); s.draftStarted = true; s.picks = []; return s; }, 'Draft wystartował!')) location.hash = '#draft';
  },
  resetDraft: async () => {
    if (await confirmModal('Zresetować draft?', 'Wszystkie wybory i składy zostaną usunięte, a zapisy otwarte ponownie. Tego nie da się cofnąć.', 'Resetuj', true)) {
      save((s) => { s.picks = []; s.lineups = {}; s.triples = {}; s.draftStarted = false; return s; }, 'Draft zresetowany');
    }
  },
  saveScoring: () => {
    const placePoints = document.getElementById('placePts').value.split(/[,\s;]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    const bonus = { quali: +document.getElementById('bQ').value, longest: +document.getElementById('bL').value, record: +document.getElementById('bR').value };
    const countChamps = document.getElementById('countChamps').checked;
    const num = (id) => +document.getElementById(id).value;
    const champ = { gold: num('cG'), silver: num('cS'), bronze: num('cB'), top10: num('cT') };
    const captainPenalty = num('pen');
    save((s) => { s.settings = { ...s.settings, placePoints, bonus, countChamps, champ, captainPenalty }; return s; }, 'Punktacja zapisana');
  },
  resetScoring: () => save((s) => { delete s.settings.placePoints; delete s.settings.bonus; delete s.settings.countChamps; delete s.settings.champ; delete s.settings.captainPenalty; return s; }, 'Przywrócono domyślną punktację'),
  renameLeague: async () => {
    const v = await modal({ title: 'Nazwa ligi', fields: [{ name: 'n', label: 'Nazwa', value: state.setup.leagueName, attrs: 'maxlength="40" required' }], ok: 'Zapisz' });
    if (v) save((s) => { s.setup.leagueName = v.n.trim(); return s; });
  },
  changeAdminPass: async () => {
    const v = await modal({ title: 'Nowe hasło admina', fields: [{ name: 'p1', label: 'Nowe hasło', type: 'password', attrs: 'minlength="4" required' }, { name: 'p2', label: 'Powtórz', type: 'password', attrs: 'minlength="4" required' }], ok: 'Zmień' });
    if (!v) return;
    if (v.p1 !== v.p2) return toast('Hasła się różnią', 'err');
    const h = await hash(state.setup.salt, v.p1);
    if (await save((s) => { s.setup.adminHash = h; return s; }, 'Hasło zmienione')) setSession({ ...session, adminHash: h });
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `skoki-draft-${today()}.json`;
    a.click();
  },
  deleteLeague: async () => {
    if (!await confirmModal('Usunąć całą ligę?', 'Znikną gracze, draft, składy i hasło admina. Najpierw pobierz kopię zapasową. Tego nie da się cofnąć.', 'Usuń ligę', true)) return;
    if (await save((s) => ({ ...s, setup: null, draftStarted: false, participants: [], draftOrder: [], picks: [], lineups: {}, triples: {}, hillRecords: {}, settings: {} }))) {
      setSession({}); location.hash = ''; render();
    }
  },
};

function moveP(i, d) {
  save((s) => { const o = s.draftOrder; [o[i], o[i + d]] = [o[i + d], o[i]]; return s; });
}

function setLineup(s, pid, fn) {
  const w = weekends.find((x) => x.id === ui.weekend);
  if (!w) fail('Brak weekendu');
  if (isLocked(w) && !isAdmin()) fail('Skład na ten weekend jest już zablokowany');
  const ids = teams(s)[pid] || [];
  const cur = lineupFor(s, weekends, w.id, pid, ids, byId);
  const next = fn({ starters: cur.starters, captain: cur.captain });
  if (!validLineup(next.starters, byId)) fail(`Skład musi mieć ${TEAM.men} mężczyzn i ${TEAM.women} kobietę`);
  if (next.captain && !next.starters.includes(next.captain)) next.captain = null;
  s.lineups[w.id] = { ...(s.lineups[w.id] || {}), [pid]: next };
  return s;
}

// ================================================================ zdarzenia

root.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-week]');
  if (link) {
    ui.weekend = link.dataset.week;
    const id = 'w-' + link.dataset.week;
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center' }), 60);
  }
  const el = e.target.closest('[data-action]');
  if ((ui.menu || ui.navMore) && !e.target.closest('.menu') && !['menu', 'navMore'].includes(el?.dataset.action)) { ui.menu = false; ui.navMore = false; render(); }
  if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  actions[el.dataset.action]?.(el);
});
root.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && (el.tagName === 'SELECT' || el.type === 'checkbox')) actions[el.dataset.action]?.(el);
  if (e.target.id === 'importFile' && e.target.files[0]) {
    e.target.files[0].text().then(async (t) => {
      const data = JSON.parse(t);
      if (!data.setup || !Array.isArray(data.participants)) throw new Error('to nie jest kopia ligi');
      if (await confirmModal('Wczytać kopię?', 'Cały obecny stan ligi zostanie zastąpiony danymi z pliku.', 'Wczytaj', true)) save(() => data, 'Kopia wczytana');
    }).catch((err) => toast('Błędny plik: ' + err.message, 'err'));
  }
});
root.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  ui.q = e.target.value;
  ui.limit = 150;
  render();
});
root.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const errBox = form.querySelector('.formerr');
  const btn = form.querySelector('button[type=submit]');
  errBox.textContent = '';
  btn.disabled = true;
  try {
    await forms[form.dataset.form](Object.fromEntries(new FormData(form)), (m) => { errBox.textContent = m; });
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (ui.menu || ui.navMore)) { ui.menu = false; ui.navMore = false; render(); } });

init();
