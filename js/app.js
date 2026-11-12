import { createStore } from './store.js';
import {
  FIS_POINTS, DEFAULT_BONUS, TEAM, TEAM_SIZE, buildWeekends, isLocked, snakeOrder, teams, canPick,
  lineupFor, validLineup, computeAll, racePoints, longestJump,
} from './scoring.js';

// ---------------------------------------------------------------- stan

const params = new URLSearchParams(location.search);
const DATA = params.get('data') || 'data';
const app = document.getElementById('app');

let state = null;      // wspólny stan ligi
let store = null;
let athletes = [];     // z data/athletes.json
let athSeason = 0;     // sezon, dla którego zbudowano listę (ranking = sezon wcześniejszy)
let byId = {};
let calendar = null;
let weekends = [];
let results = {};      // raceId -> wyniki
let calc = null;       // wynik computeAll
const ui = {           // stan widoku, tylko lokalnie
  gender: 'ALL', q: '', hideTaken: false, weekend: null, editRecord: false,
};

const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoruj */ } },
};
let me = LS.get('skoki-me', null);
let admin = LS.get('skoki-admin', false);

// ---------------------------------------------------------------- pomocnicze

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
const fmtDow = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
const range = (a, b) => (a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`);
const pname = (pid) => state.participants.find((p) => p.id === pid)?.name ?? '?';
const aname = (id) => {
  const a = byId[id];
  if (!a) return id;
  const [last, ...first] = a.name.split(' ');
  return `${first.join(' ')} ${last.charAt(0) + last.slice(1).toLowerCase()}`.trim();
};
const gtag = (g) => (g === 'W' ? '<span class="tag w">K</span>' : '<span class="tag">M</span>');
const raceLabel = (r) => `${r.category === 'QUA' ? 'Kwalifikacje' : 'Konkurs'} ${r.gender === 'W' ? 'kobiet' : 'mężczyzn'}`;
const hillShort = (d) => (d.match(/Flying/) ? 'mamucia' : d.match(/Normal/) ? 'normalna' : 'duża');
const ownerOf = (aid) => Object.entries(calc.teams).find(([, ids]) => ids.includes(aid))?.[0];
const today = () => new Date().toISOString().slice(0, 10);

function weekendStatus(w) {
  const t = today();
  if (t > w.end) return 'past';
  if (t >= w.start) return 'live';
  return 'next';
}

function currentWeekend() {
  return weekends.find((w) => weekendStatus(w) !== 'past') || weekends[weekends.length - 1];
}

async function save(fn) {
  try { await store.update(fn); } catch (e) { alert('Nie udało się zapisać: ' + e.message); }
}

// ---------------------------------------------------------------- start

async function loadData() {
  const get = async (p) => {
    const r = await fetch(`${DATA}/${p}?v=${Date.now()}`);
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [a, c] = await Promise.all([get('athletes.json'), get('calendar.json')]);
  athletes = a.athletes;
  athSeason = a.season;
  byId = Object.fromEntries(athletes.map((x, i) => [x.id, { ...x, idx: i + 1 }]));
  calendar = c;
  weekends = buildWeekends(c.events.filter((e) => !e.cancelled));
  const races = weekends.flatMap((w) => w.races).filter((r) => r.hasResults);
  const loaded = await Promise.all(races.map((r) => get(`results/${r.id}.json`).catch(() => null)));
  races.forEach((r, i) => { if (loaded[i]) results[r.id] = loaded[i]; });
}

async function init() {
  try {
    await loadData();
  } catch (e) {
    app.innerHTML = `<div class="card">Nie udało się wczytać danych FIS (${esc(e.message)}). Uruchom <code>python scraper/fis.py</code>.</div>`;
    return;
  }
  store = await createStore((s) => { state = s; render(); });
  document.getElementById('banner').innerHTML = store.mode === 'local'
    ? '<div class="banner"><div>Tryb testowy: dane ligi zapisują się tylko w tej przeglądarce. Żeby grać razem, podłącz Firebase (instrukcja w README).</div></div>'
    : '';
  document.getElementById('foot').textContent =
    `Sezon ${calendar.season - 1}/${String(calendar.season).slice(2)} · wyniki FIS zaktualizowane ${new Date(calendar.updated).toLocaleString('pl-PL')}`;
  window.addEventListener('hashchange', render);
  document.getElementById('me').addEventListener('change', (e) => { me = e.target.value || null; LS.set('skoki-me', me); render(); });
}

// ---------------------------------------------------------------- render

const views = { ranking, druzyny, kalendarz, race: raceView, draft, zawodnicy, ustawienia };

function render() {
  if (!state) return;
  calc = computeAll(state, weekends, results, byId);
  const [view, arg] = (location.hash.slice(1) || 'ranking').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view || (view === 'race' && a.dataset.view === 'kalendarz')));
  const sel = document.getElementById('me');
  sel.innerHTML = '<option value="">— wybierz —</option>' +
    state.participants.map((p) => `<option value="${p.id}" ${p.id === me ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const scrollY = window.scrollY;
  app.innerHTML = (views[view] || ranking)(arg);
  window.scrollTo(0, scrollY);
}

function needSetup() {
  return `<div class="card"><h3>Najpierw ustawcie ligę</h3><p>Dodajcie uczestników i kolejność draftu w zakładce <a href="#ustawienia">Ustawienia</a>.</p></div>`;
}

// ---------------------------------------------------------------- ranking

function ranking() {
  if (!state.participants.length) return needSetup();
  const ps = [...state.participants].sort((a, b) => calc.totals[b.id] - calc.totals[a.id]);
  const played = weekends.filter((w) => w.races.some((r) => results[r.id]));
  const best = Object.entries(calc.athleteTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return `
    <h1>Ranking</h1>
    <p class="muted">${played.length} z ${weekends.length} weekendów z wynikami</p>
    <div class="podium">
      ${ps.map((p, i) => `<div class="card ${i === 0 ? 'first' : ''}"><div class="pos">${i + 1}</div>
        <div><div><b>${esc(p.name)}</b></div><div class="pts">${calc.totals[p.id]}</div><div class="muted small">pkt</div></div></div>`).join('')}
    </div>
    <h2>Punkty w weekendach</h2>
    ${played.length ? `<div class="tablewrap"><table>
      <thead><tr><th>Weekend</th>${ps.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}</tr></thead>
      <tbody>${played.map((w) => {
        const vals = ps.map((p) => calc.byWeekend[w.id][p.id]);
        const max = Math.max(...vals);
        return `<tr><td><a href="#kalendarz" data-w="${w.id}">${w.no}. ${esc(w.name)}</a> <span class="muted small">${range(w.start, w.end)}</span></td>
          ${vals.map((v) => `<td class="num">${v === max && v > 0 ? `<b>${v}</b>` : v}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">Jeszcze nie rozegrano żadnego konkursu.</p>'}
    ${best.length ? `<h2>Najlepsi zawodnicy w zabawie</h2>
    <div class="tablewrap"><table><thead><tr><th>Zawodnik</th><th>Drużyna</th><th class="num">Pkt</th></tr></thead>
    <tbody>${best.map(([id, v]) => `<tr><td>${gtag(byId[id]?.gender)} ${esc(aname(id))} <span class="muted small">${esc(byId[id]?.nation)}</span></td><td>${esc(pname(ownerOf(id)))}</td><td class="num"><b>${v}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
  `;
}

// ---------------------------------------------------------------- draft

function draftInfo() {
  const seq = snakeOrder(state.draftOrder);
  const n = state.picks.length;
  return { seq, n, cur: seq[n], done: seq.length > 0 && n >= seq.length };
}

function draft() {
  if (state.participants.length < 2 || state.draftOrder.length !== state.participants.length) return needSetup();
  const { seq, n, cur, done } = draftInfo();
  const P = state.draftOrder.length;
  const taken = new Map(state.picks.map((aid, i) => [aid, seq[i]]));
  const myTurn = cur && (cur.pid === me || admin);
  const myTeam = cur ? calc.teams[cur.pid] : [];

  const list = athletes.filter((a) =>
    (ui.gender === 'ALL' || a.gender === ui.gender) &&
    (!ui.hideTaken || !taken.has(a.id)) &&
    (!ui.q || (a.name + ' ' + a.nation).toLowerCase().includes(ui.q.toLowerCase())));

  const cells = [];
  for (let r = 0; r < TEAM_SIZE; r++) {
    for (let c = 0; c < P; c++) {
      const i = r * P + c;
      const s = seq[i];
      const col = state.draftOrder.indexOf(s.pid);
      const aid = state.picks[i];
      cells.push(`<div class="cell ${i === n ? 'now' : ''}" style="grid-column:${col + 1};grid-row:${r + 2}">
        <div class="r">#${i + 1} · runda ${r + 1}</div>${aid ? `${gtag(byId[aid]?.gender)} ${esc(aname(aid))}` : ''}</div>`);
    }
  }

  return `
    <h1>Draft</h1>
    <p class="muted">Snake draft: ${state.draftOrder.map(pname).map(esc).join(' → ')} → i z powrotem. Każdy wybiera ${TEAM_SIZE} zawodników (${TEAM.men} M + ${TEAM.women} K + ${TEAM.reserves} rezerwowych dowolnej płci).</p>
    <div class="card row">
      ${done ? '<div class="onclock">✅ Draft zakończony! Zobacz <a href="#druzyny">drużyny</a>.</div>'
        : `<div class="onclock">Wybór #${n + 1} (runda ${cur.round}) — wybiera <b>${esc(pname(cur.pid))}</b>
           ${cur.pid === me ? ' — <b>Twoja kolej!</b>' : ''}</div>`}
      <span class="spacer"></span>
      ${n > 0 && (admin || seq[n - 1].pid === me) ? '<button data-action="undo" class="sm">↶ Cofnij ostatni wybór</button>' : ''}
    </div>
    ${!me && !done ? '<p class="muted small">Wybierz u góry, kim jesteś, żeby móc wybierać zawodników.</p>' : ''}
    <h2>Tablica draftu</h2>
    <div class="board" style="grid-template-columns:repeat(${P}, minmax(110px, 1fr))">
      ${state.draftOrder.map((pid, c) => `<div class="head" style="grid-column:${c + 1};grid-row:1">${esc(pname(pid))}</div>`).join('')}
      ${cells.join('')}
    </div>
    <h2>Zawodnicy</h2>
    <div class="row" style="margin-bottom:.6rem">
      <div class="seg">${[['ALL', 'Wszyscy'], ['M', 'Mężczyźni'], ['W', 'Kobiety']].map(([k, l]) =>
        `<button data-action="gender" data-v="${k}" class="${ui.gender === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input id="q" placeholder="Szukaj zawodnika / kraju" value="${esc(ui.q)}">
      <label class="small"><input type="checkbox" data-action="hideTaken" ${ui.hideTaken ? 'checked' : ''}> ukryj wybranych</label>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th class="num">#</th><th>Zawodnik</th><th>Kraj</th><th class="num">PŚ ${athSeason - 2}/${String(athSeason - 1).slice(2)}</th><th class="num">Miejsce</th><th class="num">LGP ${athSeason - 1}</th><th></th></tr></thead>
      <tbody>${list.map((a) => {
        const t = taken.get(a.id);
        const ok = !t && myTurn && !done && canPick(myTeam, a.gender, byId);
        return `<tr class="${t ? 'dim' : ''}">
          <td class="num muted">${byId[a.id].idx}</td>
          <td>${gtag(a.gender)} <b>${esc(a.name)}</b></td>
          <td>${esc(a.nation)}</td>
          <td class="num">${a.wc || '–'}</td>
          <td class="num">${a.wcRank || '–'}</td>
          <td class="num">${a.gp || '–'}</td>
          <td>${t ? `<span class="tag acc">${esc(pname(t.pid))}</span>` : `<button class="sm primary" data-action="pick" data-id="${a.id}" ${ok ? '' : 'disabled'}>Wybierz</button>`}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
  `;
}

// ---------------------------------------------------------------- drużyny

function druzyny() {
  if (!state.participants.length) return needSetup();
  const w = weekends.find((x) => x.id === ui.weekend) || currentWeekend();
  if (!w) return '<p>Brak kalendarza.</p>';
  ui.weekend = w.id;
  const locked = isLocked(w);
  return `
    <h1>Drużyny</h1>
    <div class="row">
      <label>Weekend: <select data-action="weekend">${weekends.map((x) =>
        `<option value="${x.id}" ${x.id === w.id ? 'selected' : ''}>${x.no}. ${esc(x.name)} (${range(x.start, x.end)})</option>`).join('')}</select></label>
      ${locked ? '<span class="tag warn">🔒 składy i kapitanowie zablokowani</span>' : '<span class="tag good">można zmieniać skład i kapitana do północy przed pierwszym dniem</span>'}
    </div>
    <div class="grid" style="margin-top:1rem">${state.participants.map((p) => teamCard(p, w, locked)).join('')}</div>
  `;
}

function teamCard(p, w, locked) {
  const ids = calc.teams[p.id] || [];
  const l = lineupFor(state, weekends, w.id, p.id, ids, byId);
  const editable = (p.id === me || admin) && (!locked || admin) && ids.length === TEAM_SIZE;
  const wpts = {};
  for (const r of w.races) for (const a of calc.byRace[r.id]?.[p.id]?.athletes || []) wpts[a.id] = (wpts[a.id] || 0) + a.pts;
  const reserves = ids.filter((id) => !l.starters.includes(id));

  const line = (id, starter) => {
    const a = byId[id];
    const isCap = l.captain === id;
    let ctrl = '';
    if (editable && starter) {
      ctrl = `<button class="sm" data-action="captain" data-p="${p.id}" data-id="${id}" title="Ustaw kapitana">${isCap ? '🧢' : 'K'}</button>`;
    } else if (editable && !starter) {
      const same = l.starters.filter((s) => byId[s]?.gender === a?.gender);
      ctrl = `<select class="sm" data-action="swap" data-p="${p.id}" data-id="${id}"><option value="">wejdź za…</option>${same.map((s) => `<option value="${s}">${esc(aname(s))}</option>`).join('')}</select>`;
    }
    return `<div class="player">${gtag(a?.gender)}<span class="name">${isCap ? '<span class="cap">🧢</span> ' : ''}${esc(aname(id))} <span class="muted small">${esc(a?.nation)}</span></span>
      ${wpts[id] ? `<span class="pts">${wpts[id]}</span>` : ''}${ctrl}</div>`;
  };

  const men = l.starters.filter((id) => byId[id]?.gender === 'M');
  const women = l.starters.filter((id) => byId[id]?.gender === 'W');
  return `<div class="card">
    <div class="row"><h3>${esc(p.name)}${p.id === me ? ' <span class="tag acc">Ty</span>' : ''}</h3><span class="spacer"></span>
      <span><b>${calc.byWeekend[w.id]?.[p.id] || 0}</b> <span class="muted small">pkt w weekendzie</span></span></div>
    ${ids.length < TEAM_SIZE ? `<p class="muted small">Drużyna niekompletna (${ids.length}/${TEAM_SIZE}) — dokończcie <a href="#draft">draft</a>.</p>` : ''}
    ${!l.captain && ids.length ? `<p class="small" style="color:var(--warn)">Brak kapitana na ten weekend${editable ? ' — kliknij K przy zawodniku.' : '.'}</p>` : ''}
    <div class="sect">Mężczyźni</div>${men.map((id) => line(id, true)).join('')}
    <div class="sect">Kobieta</div>${women.map((id) => line(id, true)).join('')}
    <div class="sect">Rezerwowi</div>${reserves.map((id) => line(id, false)).join('') || '<div class="muted small">—</div>'}
  </div>`;
}

// ---------------------------------------------------------------- kalendarz

function kalendarz() {
  const cur = currentWeekend();
  return `
    <h1>Kalendarz Pucharu Świata</h1>
    <p class="muted">Kliknij konkurs, żeby zobaczyć wyniki i punkty w zabawie.</p>
    ${weekends.map((w) => {
      const st = weekendStatus(w);
      const hasRes = w.races.some((r) => results[r.id]);
      return `<div class="card weekend ${st}" id="w-${w.id}">
        <div class="wh"><span class="title">${w.no}. ${esc(w.name)}</span><span class="muted">${range(w.start, w.end)}</span>
          ${st === 'live' ? '<span class="tag warn">trwa</span>' : st === 'past' ? '<span class="tag">zakończony</span>' : w === cur ? '<span class="tag acc">najbliższy</span>' : ''}
          <span class="spacer"></span>
          ${hasRes && state.participants.length ? `<div class="chips">${state.participants.map((p) => `<span class="chip">${esc(p.name)} <b>${calc.byWeekend[w.id][p.id]}</b></span>`).join('')}</div>` : ''}
        </div>
        ${w.races.map((r) => {
          const res = results[r.id];
          const win = res?.results.find((x) => x.rank === 1);
          return `<div class="race">
            <span class="muted small">${fmtDow(r.date)}${r.time ? ' ' + r.time : ''}</span>
            <span>${gtag(r.gender)} ${res ? `<a href="#race/${r.id}">${raceLabel(r)}</a>` : raceLabel(r)} <span class="muted small">· ${esc(r.place)} · skocznia ${hillShort(r.discipline)}${r.cancelled ? ' · odwołany' : ''}</span>
              ${win ? `<span class="small"> — 🥇 ${esc(aname(win.id) || win.name)}</span>` : ''}</span>
            <span>${res && state.participants.length ? `<span class="chips">${state.participants.map((p) => {
              const v = calc.byRace[r.id]?.[p.id]?.total || 0;
              return v ? `<span class="chip">${esc(p.name)} <b>+${v}</b></span>` : '';
            }).join('')}</span>` : ''}</span>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
  `;
}

function raceView(id) {
  const w = weekends.find((x) => x.races.some((r) => r.id === id));
  const race = w?.races.find((r) => r.id === id);
  const res = results[id];
  if (!race || !res) return '<p>Brak wyników tego konkursu. <a href="#kalendarz">Wróć do kalendarza</a></p>';
  const pts = racePoints(race, res, state.settings, state.hillRecords[id] || []);
  const lj = race.category === 'WC' ? longestJump(res) : 0;
  const records = state.hillRecords[id] || [];
  const lineups = Object.fromEntries(state.participants.map((p) => [p.id, lineupFor(state, weekends, w.id, p.id, calc.teams[p.id] || [], byId)]));
  const ownerInfo = (aid) => {
    const pid = ownerOf(aid);
    if (!pid) return '';
    const l = lineups[pid];
    const starter = l.starters.includes(aid);
    return `<span class="tag ${starter ? 'acc' : ''}">${esc(pname(pid))}${l.captain === aid ? ' 🧢' : ''}${starter ? '' : ' (rez.)'}</span>`;
  };
  const sorted = [...res.results].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  return `
    <p><a href="#kalendarz">← Kalendarz</a></p>
    <h1>${raceLabel(race)} — ${esc(race.place)}</h1>
    <p class="muted">${fmtDow(race.date)} · skocznia ${hillShort(race.discipline)} · weekend ${w.no}
      ${lj ? ` · najdłuższy skok: <b>${lj} m</b>` : ''} · <a href="https://www.fis-ski.com/DB/general/results.html?sectorcode=JP&raceid=${id}" target="_blank" rel="noopener">oficjalne wyniki FIS ↗</a></p>
    ${state.participants.length ? `<div class="grid">${state.participants.map((p) => {
      const e = calc.byRace[id]?.[p.id] || { total: 0, athletes: [] };
      return `<div class="card"><div class="row"><h3>${esc(p.name)}</h3><span class="spacer"></span><b>+${e.total}</b></div>
        ${e.athletes.map((a) => `<div class="player"><span class="name">${a.captain ? '<span class="cap">🧢</span> ' : ''}${esc(aname(a.id))}</span>
          <span class="muted small">${breakdown(a.base)}${a.captain ? ' ×2' : ''}</span><span class="pts">${a.pts}</span></div>`).join('') || '<div class="muted small">brak punktów</div>'}
      </div>`;
    }).join('')}</div>` : ''}
    <h2 class="row">Wyniki <span class="spacer"></span>
      ${race.category === 'WC' ? `<button class="sm" data-action="editRecord">${ui.editRecord ? 'Gotowe' : 'Oznacz rekord skoczni'}</button>` : ''}</h2>
    ${ui.editRecord ? '<p class="small muted">Zaznacz zawodnika, który ustanowił oficjalnie uznany rekord skoczni (+15 pkt). Zmiana zapisuje się od razu dla wszystkich.</p>' : ''}
    <div class="tablewrap"><table>
      <thead><tr><th class="num">Msc</th><th>Zawodnik</th><th>Kraj</th>${race.category === 'WC' ? '<th class="num">Skoki (m)</th>' : '<th class="num">Odl. (m)</th>'}<th class="num">Nota</th><th class="num">Pkt w zabawie</th><th>Drużyna</th>${ui.editRecord ? '<th>Rekord</th>' : ''}</tr></thead>
      <tbody>${sorted.map((r) => {
        const p = pts.get(r.id);
        return `<tr class="${ownerOf(r.id) === me && me ? 'mine' : ''}">
          <td class="num">${r.rank ?? '<span class="muted">DSQ</span>'}</td>
          <td><b>${esc(r.name)}</b></td><td>${esc(r.nation)}</td>
          <td class="num">${r.jumps.map((j) => (j === lj ? `<span class="longest">${j}</span>` : j)).join(' / ')}</td>
          <td class="num">${r.total ?? ''}</td>
          <td class="num">${p?.total ? `<b>${p.total}</b> <span class="bonus">${bonusTags(p)}</span>` : ''}</td>
          <td>${ownerInfo(r.id)}</td>
          ${ui.editRecord ? `<td><input type="checkbox" data-action="record" data-race="${id}" data-id="${r.id}" ${records.includes(r.id) ? 'checked' : ''}></td>` : ''}
        </tr>`;
      }).join('')}</tbody></table></div>
  `;
}

function breakdown(b) {
  const parts = [];
  if (b.place) parts.push(`miejsce ${b.place}`);
  if (b.quali) parts.push(`wygrane kwal. ${b.quali}`);
  if (b.longest) parts.push(`najdł. skok ${b.longest}`);
  if (b.record) parts.push(`rekord ${b.record}`);
  return parts.join(' + ');
}

function bonusTags(p) {
  return [p.quali && '🏁', p.longest && '📏', p.record && '⭐'].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- zawodnicy

function zawodnicy() {
  const raw = {};
  for (const w of weekends) for (const r of w.races) {
    if (!results[r.id]) continue;
    for (const [id, p] of racePoints(r, results[r.id], state.settings, state.hillRecords[r.id] || [])) raw[id] = (raw[id] || 0) + p.total;
  }
  const list = athletes.filter((a) => (ui.gender === 'ALL' || a.gender === ui.gender) &&
    (!ui.q || (a.name + ' ' + a.nation).toLowerCase().includes(ui.q.toLowerCase())))
    .sort((a, b) => (raw[b.id] || 0) - (raw[a.id] || 0) || byId[a.id].idx - byId[b.id].idx);
  return `
    <h1>Zawodnicy</h1>
    <p class="muted">„Pkt sezonu” to punkty, które zawodnik zdobyłby w zabawie (bez kapitana). „Dla drużyny” — punkty faktycznie zdobyte dla właściciela (tylko w składzie, z kapitanem).</p>
    <div class="row" style="margin-bottom:.6rem">
      <div class="seg">${[['ALL', 'Wszyscy'], ['M', 'Mężczyźni'], ['W', 'Kobiety']].map(([k, l]) =>
        `<button data-action="gender" data-v="${k}" class="${ui.gender === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input id="q" placeholder="Szukaj zawodnika / kraju" value="${esc(ui.q)}">
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>Zawodnik</th><th>Kraj</th><th class="num">Pkt sezonu</th><th class="num">Dla drużyny</th><th>Drużyna</th></tr></thead>
      <tbody>${list.map((a) => `<tr><td>${gtag(a.gender)} <b>${esc(a.name)}</b></td><td>${esc(a.nation)}</td>
        <td class="num">${raw[a.id] || 0}</td><td class="num">${calc.athleteTotals[a.id] || ''}</td>
        <td>${ownerOf(a.id) ? `<span class="tag acc">${esc(pname(ownerOf(a.id)))}</span>` : '<span class="muted small">wolny</span>'}</td></tr>`).join('')}</tbody>
    </table></div>
  `;
}

// ---------------------------------------------------------------- ustawienia

function ustawienia() {
  const started = state.picks.length > 0;
  const s = state.settings;
  const bonus = { ...DEFAULT_BONUS, ...(s.bonus || {}) };
  return `
    <h1>Ustawienia</h1>
    <div class="stack">
    <div class="card">
      <h3>Uczestnicy i kolejność draftu</h3>
      ${state.draftOrder.map((pid, i) => `<div class="player"><b>${i + 1}.</b><span class="name">${esc(pname(pid))}</span>
        ${started ? '' : `<button class="sm" data-action="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="sm" data-action="down" data-i="${i}" ${i === state.draftOrder.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="sm danger" data-action="removeP" data-id="${pid}">Usuń</button>`}</div>`).join('') || '<p class="muted">Brak uczestników.</p>'}
      ${started ? '<p class="muted small">Draft już się rozpoczął — lista uczestników jest zablokowana.</p>' : `
        <div class="row" style="margin-top:.75rem"><input id="newP" placeholder="Imię uczestnika"><button data-action="addP">Dodaj</button>
        <button data-action="shuffle" ${state.draftOrder.length < 2 ? 'disabled' : ''}>🎲 Losuj kolejność</button></div>`}
    </div>
    <div class="card">
      <h3>Punktacja</h3>
      <p class="small muted">Punkty za miejsca 1, 2, 3… (domyślnie punktacja Pucharu Świata FIS). Bonusy dodawane są do punktów za miejsce; kapitan ×2.</p>
      <textarea id="placePts">${(s.placePoints || FIS_POINTS).join(', ')}</textarea>
      <div class="row" style="margin-top:.5rem">
        <label>Zwycięstwo w kwalifikacjach <input id="bQ" type="number" value="${bonus.quali}" style="width:5rem"></label>
        <label>Najdłuższy skok <input id="bL" type="number" value="${bonus.longest}" style="width:5rem"></label>
        <label>Rekord skoczni <input id="bR" type="number" value="${bonus.record}" style="width:5rem"></label>
        <button data-action="saveScoring">Zapisz punktację</button>
        <button data-action="resetScoring" class="sm">Przywróć domyślne</button>
      </div>
    </div>
    <div class="card">
      <h3>Tryb administratora</h3>
      <p class="small muted">Pozwala na tym urządzeniu wybierać za innych w drafcie, cofać wybory i zmieniać zablokowane składy (np. do poprawek).</p>
      <label><input type="checkbox" data-action="admin" ${admin ? 'checked' : ''}> włącz tryb administratora</label>
    </div>
    <div class="card">
      <h3>Kopia zapasowa</h3>
      <div class="row"><button data-action="export">⬇ Pobierz stan ligi (JSON)</button>
        <label class="btn">⬆ Wczytaj z pliku<input type="file" id="importFile" accept=".json" hidden></label>
        <span class="spacer"></span>
        <button class="danger" data-action="resetDraft" ${started ? '' : 'disabled'}>Zresetuj draft</button></div>
    </div>
    </div>
  `;
}

// ---------------------------------------------------------------- akcje

const uid = () => 'p' + Math.random().toString(36).slice(2, 8);

const actions = {
  gender: (el) => { ui.gender = el.dataset.v; render(); },
  hideTaken: (el) => { ui.hideTaken = el.checked; render(); },
  weekend: (el) => { ui.weekend = el.value; render(); },
  editRecord: () => { ui.editRecord = !ui.editRecord; render(); },
  admin: (el) => { admin = el.checked; LS.set('skoki-admin', admin); render(); },

  pick: (el) => {
    const aid = el.dataset.id;
    const { cur } = draftInfo();
    if (!cur) return;
    save((s) => {
      // ponowne sprawdzenie na świeżym stanie – ktoś mógł wybrać w międzyczasie
      const seq = snakeOrder(s.draftOrder);
      const c = seq[s.picks.length];
      if (!c || c.pid !== cur.pid || s.picks.includes(aid)) throw new Error('stan draftu się zmienił, spróbuj ponownie');
      s.picks.push(aid);
      return s;
    });
  },
  undo: () => { if (confirm('Cofnąć ostatni wybór?')) save((s) => { s.picks.pop(); return s; }); },

  captain: (el) => {
    const { p, id } = el.dataset;
    save((s) => setLineup(s, p, (l) => ({ ...l, captain: l.captain === id ? null : id })));
  },
  swap: (el) => {
    const { p, id } = el.dataset;
    const out = el.value;
    if (!out) return;
    save((s) => setLineup(s, p, (l) => ({
      starters: l.starters.map((x) => (x === out ? id : x)),
      captain: l.captain === out ? null : l.captain,
    })));
  },
  record: (el) => {
    const { race, id } = el.dataset;
    save((s) => {
      const cur = new Set(s.hillRecords[race] || []);
      el.checked ? cur.add(id) : cur.delete(id);
      s.hillRecords[race] = [...cur];
      return s;
    });
  },

  addP: () => {
    const inp = document.getElementById('newP');
    const name = inp.value.trim();
    if (!name) return;
    save((s) => { const id = uid(); s.participants.push({ id, name }); s.draftOrder.push(id); return s; });
  },
  removeP: (el) => save((s) => {
    s.participants = s.participants.filter((p) => p.id !== el.dataset.id);
    s.draftOrder = s.draftOrder.filter((x) => x !== el.dataset.id);
    return s;
  }),
  up: (el) => moveP(+el.dataset.i, -1),
  down: (el) => moveP(+el.dataset.i, 1),
  shuffle: () => save((s) => {
    const o = s.draftOrder;
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    return s;
  }),
  saveScoring: () => {
    const placePoints = document.getElementById('placePts').value.split(/[,\s;]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    const bonus = { quali: +document.getElementById('bQ').value, longest: +document.getElementById('bL').value, record: +document.getElementById('bR').value };
    save((s) => { s.settings = { ...s.settings, placePoints, bonus }; return s; });
  },
  resetScoring: () => save((s) => { delete s.settings.placePoints; delete s.settings.bonus; return s; }),
  resetDraft: () => {
    if (confirm('Na pewno zresetować draft? Wszystkie wybory i składy zostaną usunięte.')) {
      save((s) => { s.picks = []; s.lineups = {}; return s; });
    }
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `skoki-draft-${today()}.json`;
    a.click();
  },
};

function moveP(i, d) {
  save((s) => { const o = s.draftOrder; [o[i], o[i + d]] = [o[i + d], o[i]]; return s; });
}

function setLineup(s, pid, fn) {
  const w = weekends.find((x) => x.id === ui.weekend);
  if (!w) throw new Error('brak weekendu');
  if (isLocked(w) && !admin) throw new Error('skład na ten weekend jest już zablokowany');
  const ids = teams(s)[pid] || [];
  const cur = lineupFor(s, weekends, w.id, pid, ids, byId);
  const next = fn({ starters: cur.starters, captain: cur.captain });
  if (!validLineup(next.starters, byId)) throw new Error(`skład musi mieć ${TEAM.men} mężczyzn i ${TEAM.women} kobietę`);
  if (next.captain && !next.starters.includes(next.captain)) next.captain = null;
  s.lineups[w.id] = { ...(s.lineups[w.id] || {}), [pid]: next };
  return s;
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  actions[el.dataset.action]?.(el);
});
app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && (el.tagName === 'SELECT' || el.type === 'checkbox')) actions[el.dataset.action]?.(el);
  if (e.target.id === 'importFile' && e.target.files[0]) {
    e.target.files[0].text().then((t) => {
      const data = JSON.parse(t);
      if (confirm('Zastąpić cały stan ligi danymi z pliku?')) save(() => data);
    }).catch((err) => alert('Błędny plik: ' + err.message));
  }
});
app.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  ui.q = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const q = document.getElementById('q');
  q.focus();
  q.setSelectionRange(pos, pos);
});
app.addEventListener('keydown', (e) => {
  if (e.target.id === 'newP' && e.key === 'Enter') actions.addP();
});
// link z rankingu do weekendu w kalendarzu
app.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-w]');
  if (a) setTimeout(() => document.getElementById('w-' + a.dataset.w)?.scrollIntoView({ block: 'start' }), 50);
});

init();
