// Liczenie punktów w zabawie na podstawie wyników FIS.

// Domyślnie: punkty Pucharu Świata FIS za miejsca 1–30.
export const FIS_POINTS = [100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16,
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export const DEFAULT_BONUS = { quali: 5, longest: 10, record: 15 };
// Mistrzostwa Świata: medale i miejsca 4–10
export const DEFAULT_CHAMP = { gold: 500, silver: 300, bronze: 200, top10: 50 };
// kara, gdy kapitan skończy konkurs poza czołową 30 (albo w nim nie wystąpi)
export const DEFAULT_PENALTY = 20;
// raz w sezonie: wszystkie punkty drużyny w wybranym konkursie ×3
export const TRIPLE = 3;

export const TEAM = { men: 6, women: 1, reserves: 2 };
export const TEAM_SIZE = TEAM.men + TEAM.women + TEAM.reserves;

export const isMain = (race) => race.category !== 'QUA';
// mnożnik ×3: tylko konkursy PŚ (nie kwalifikacje, nie Mistrzostwa Świata)
export const canTriple = (race) => isMain(race) && !race.champ;
// Mistrzostwa Świata liczą się do ligi, chyba że admin to wyłączy.
export const countsForLeague = (race, settings) => !race.champ || settings.countChamps !== false;

export function scoringSettings(settings = {}) {
  return {
    placePoints: settings.placePoints || FIS_POINTS,
    bonus: { ...DEFAULT_BONUS, ...(settings.bonus || {}) },
    champ: { ...DEFAULT_CHAMP, ...(settings.champ || {}) },
    penalty: settings.captainPenalty ?? DEFAULT_PENALTY,
  };
}

// Rekordziści konkursu: wykryci automatycznie z protokołu FIS, chyba że admin to poprawił.
export function recordIds(state, raceId, result) {
  const manual = state.hillRecords?.[raceId];
  return Array.isArray(manual) ? manual : result?.recordBreakers || [];
}

// Punkty za miejsce w konkursie głównym (PŚ – tabela punktów, MŚ – medale i top 10).
function placePoints(race, rank, cfg) {
  if (!rank) return 0;
  if (race.champ) {
    if (rank === 1) return cfg.champ.gold;
    if (rank === 2) return cfg.champ.silver;
    if (rank === 3) return cfg.champ.bronze;
    return rank <= 10 ? cfg.champ.top10 : 0;
  }
  return rank <= cfg.placePoints.length ? cfg.placePoints[rank - 1] : 0;
}

// Punkty każdego zawodnika w jednym konkursie (bez kapitana i mnożnika).
// Kwalifikacje: tylko zwycięstwo w kwalifikacjach i rekord skoczni.
// Zwraca Map athleteId -> { place, longest, quali, record, total }
export function racePoints(race, result, settings, records = []) {
  const cfg = scoringSettings(settings);
  const out = new Map();
  if (!result) return out;
  const get = (id) => {
    if (!out.has(id)) out.set(id, { place: 0, longest: 0, quali: 0, record: 0, total: 0 });
    return out.get(id);
  };

  if (!isMain(race)) {
    for (const r of result.results) if (r.rank === 1) get(r.id).quali = cfg.bonus.quali;
  } else {
    for (const r of result.results) {
      const p = placePoints(race, r.rank, cfg);
      if (p) get(r.id).place = p;
    }
    // najdłuższy skok konkursu (wszystkie serie konkursu głównego); remis = wszyscy dostają bonus
    const max = longestJump(result);
    if (max > 0) {
      for (const r of result.results) if ((r.jumps || []).includes(max)) get(r.id).longest = cfg.bonus.longest;
    }
  }
  for (const id of records) get(id).record = cfg.bonus.record;
  for (const p of out.values()) p.total = p.place + p.longest + p.quali + p.record;
  return out;
}

export function longestJump(result) {
  return Math.max(0, ...(result?.results || []).flatMap((r) => r.jumps || []));
}

// ---------------------------------------------------------------- weekendy

// Weekend = grupa zawodów (M i K), których terminy na siebie zachodzą.
export function buildWeekends(events) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const weekends = [];
  for (const ev of sorted) {
    const last = weekends[weekends.length - 1];
    if (last && ev.start <= last.end) {
      last.events.push(ev);
      if (ev.end > last.end) last.end = ev.end;
    } else {
      weekends.push({ id: ev.start, start: ev.start, end: ev.end, events: [ev] });
    }
  }
  weekends.forEach((w, i) => {
    w.no = i + 1;
    w.name = w.events.map((e) => e.place).join(' / ');
    w.champ = w.events.some((e) => e.championship);
    w.races = w.events.flatMap((e) => e.races.map((r) => ({ ...r, place: e.place, nation: e.nation, eventId: e.id, champ: !!e.championship })))
      // według rzeczywistego momentu startu (różne strefy czasowe w jednym weekendzie);
      // bez godziny kwalifikacje danego dnia idą przed konkursem
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time && b.time ? raceStart(a) - raceStart(b) : 0)
        || (a.category === 'QUA' ? 0 : 1) - (b.category === 'QUA' ? 0 : 1));
  });
  return weekends;
}

// FIS podaje godziny startu w czasie lokalnym skoczni.
const TZ = {
  NOR: 'Europe/Oslo', SWE: 'Europe/Stockholm', FIN: 'Europe/Helsinki', GER: 'Europe/Berlin', AUT: 'Europe/Vienna',
  SUI: 'Europe/Zurich', SLO: 'Europe/Ljubljana', POL: 'Europe/Warsaw', ITA: 'Europe/Rome', CZE: 'Europe/Prague',
  JPN: 'Asia/Tokyo', CHN: 'Asia/Shanghai', USA: 'America/New_York', CAN: 'America/Toronto',
};

// Start konkursu jako moment w czasie. Bez godziny (FIS jeszcze jej nie podał) – północ dnia konkursu.
export function raceStart(r) {
  if (!r.time) return new Date(r.date + 'T00:00:00');
  const [y, m, d] = r.date.split('-').map(Number);
  const [hh, mm] = r.time.split(':').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const tz = TZ[r.nation] || 'Europe/Warsaw';
  const offset = new Date(utc.toLocaleString('en-US', { timeZone: tz })) - new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(utc - offset);
}

// Pierwszy (nieodwołany) start weekendu – zwykle pierwsze kwalifikacje.
export function firstRace(weekend) {
  return weekend.races.filter((r) => !r.cancelled).sort((a, b) => raceStart(a) - raceStart(b))[0];
}

// Skład i kapitan blokują się minutę przed pierwszym startem weekendu.
export function lockTime(weekend) {
  const r = firstRace(weekend);
  return new Date((r ? raceStart(r) : new Date(weekend.start + 'T00:00:00')).getTime() - 60 * 1000);
}

export function isLocked(weekend, now = new Date()) {
  return now >= lockTime(weekend);
}

// ---------------------------------------------------------------- drużyny

export function snakeOrder(order, rounds = TEAM_SIZE) {
  const seq = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? order : [...order].reverse();
    row.forEach((pid) => seq.push({ pid, round: r + 1 }));
  }
  return seq;
}

export function teams(state) {
  const seq = snakeOrder(state.draftOrder || []);
  const t = Object.fromEntries((state.participants || []).map((p) => [p.id, []]));
  (state.picks || []).forEach((aid, i) => {
    const s = seq[i];
    if (s && t[s.pid]) t[s.pid].push(aid);
  });
  return t;
}

// Czy uczestnik może jeszcze wybrać zawodnika danej płci (żeby dało się ułożyć 6M + 1K + 2 rez.).
export function canPick(teamIds, gender, athletesById) {
  const men = teamIds.filter((id) => athletesById[id]?.gender === 'M').length + (gender === 'M' ? 1 : 0);
  const women = teamIds.filter((id) => athletesById[id]?.gender === 'W').length + (gender === 'W' ? 1 : 0);
  const total = teamIds.length + 1;
  if (total > TEAM_SIZE) return false;
  const need = Math.max(0, TEAM.men - men) + Math.max(0, TEAM.women - women);
  return TEAM_SIZE - total >= need;
}

// Domyślny skład: pierwszych 6 wybranych mężczyzn i pierwsza kobieta.
export function defaultLineup(teamIds, athletesById) {
  const men = teamIds.filter((id) => athletesById[id]?.gender === 'M').slice(0, TEAM.men);
  const women = teamIds.filter((id) => athletesById[id]?.gender === 'W').slice(0, TEAM.women);
  return { starters: [...men, ...women], captain: null };
}

// Skład na weekend: ustawiony dla tego weekendu, a jeśli nie – ostatni wcześniejszy, a jeśli nie – domyślny.
export function lineupFor(state, weekends, weekendId, pid, teamIds, athletesById) {
  const lineups = state.lineups || {};
  const idx = weekends.findIndex((w) => w.id === weekendId);
  for (let i = idx; i >= 0; i--) {
    const l = lineups[weekends[i].id]?.[pid];
    if (l) {
      const starters = l.starters.filter((id) => teamIds.includes(id));
      // kapitan przechodzi tylko, jeśli ustawiono go na ten konkretny weekend
      return { starters, captain: i === idx ? l.captain : null, inherited: i !== idx };
    }
  }
  return { ...defaultLineup(teamIds, athletesById), inherited: true };
}

export function validLineup(starters, athletesById) {
  const men = starters.filter((id) => athletesById[id]?.gender === 'M').length;
  const women = starters.filter((id) => athletesById[id]?.gender === 'W').length;
  return men === TEAM.men && women === TEAM.women;
}

// ---------------------------------------------------------------- całość

// Punkty wszystkich uczestników we wszystkich konkursach.
// byRace[raceId][pid] = { total, athletes: [{ id, pts, base, captain }], penalty, triple }
export function computeAll(state, weekends, results, athletesById) {
  const settings = state.settings || {};
  const cfg = scoringSettings(settings);
  const tm = teams(state);
  const byRace = {};
  const byWeekend = {};
  const totals = {};
  const athleteTotals = {};
  const penalties = {};
  for (const p of state.participants || []) { totals[p.id] = 0; penalties[p.id] = 0; }

  for (const w of weekends) {
    byWeekend[w.id] = {};
    const lineups = {};
    for (const p of state.participants || []) {
      lineups[p.id] = lineupFor(state, weekends, w.id, p.id, tm[p.id] || [], athletesById);
      byWeekend[w.id][p.id] = 0;
    }
    for (const race of w.races) {
      const res = results[race.id];
      if (!res || !countsForLeague(race, settings)) continue;
      const pts = racePoints(race, res, settings, recordIds(state, race.id, res));
      const rankOf = Object.fromEntries(res.results.map((r) => [r.id, r.rank]));
      byRace[race.id] = {};
      for (const p of state.participants || []) {
        const l = lineups[p.id];
        const triple = canTriple(race) && state.triples?.[p.id] === race.id;
        const mult = triple ? TRIPLE : 1;
        const entry = { total: 0, athletes: [], penalty: 0, triple };
        for (const aid of l.starters) {
          const ap = pts.get(aid);
          if (!ap || !ap.total) continue;
          const cap = l.captain === aid;
          const v = ap.total * (cap ? 2 : 1) * mult;
          entry.total += v;
          entry.athletes.push({ id: aid, pts: v, base: ap, captain: cap });
          athleteTotals[aid] = (athleteTotals[aid] || 0) + v;
        }
        // kara za kapitana poza top 30 – w konkursach jego płci (PŚ i MŚ, nie w kwalifikacjach)
        const c = l.captain;
        if (c && isMain(race) && athletesById[c]?.gender === race.gender) {
          const rank = rankOf[c];
          if (!rank || rank > 30) {
            entry.penalty = -cfg.penalty * mult;
            entry.total += entry.penalty;
            penalties[p.id] += entry.penalty;
          }
        }
        byRace[race.id][p.id] = entry;
        byWeekend[w.id][p.id] += entry.total;
        totals[p.id] += entry.total;
      }
    }
  }
  return { byRace, byWeekend, totals, athleteTotals, penalties, teams: tm };
}

// Klasyfikacja generalna PŚ bieżącego sezonu liczona z wyników (punkty FIS za miejsca 1–30).
export function wcStandings(weekends, results, gender) {
  const pts = {};
  const info = {};
  let races = 0;
  for (const w of weekends) {
    for (const r of w.races) {
      if (r.category !== 'WC' || r.gender !== gender || !results[r.id]) continue;
      races++;
      for (const x of results[r.id].results) {
        info[x.id] = { id: x.id, name: x.name, nation: x.nation };
        if (x.rank && x.rank <= FIS_POINTS.length) pts[x.id] = (pts[x.id] || 0) + FIS_POINTS[x.rank - 1];
      }
    }
  }
  const rows = Object.entries(pts).map(([id, points]) => ({ ...info[id], points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1; });
  return { rows, races };
}
