// Liczenie punktów w zabawie na podstawie wyników FIS.

// Domyślnie: punkty Pucharu Świata FIS za miejsca 1–30.
export const FIS_POINTS = [100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16,
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export const DEFAULT_BONUS = { quali: 5, longest: 10, record: 15 };

export const TEAM = { men: 6, women: 1, reserves: 2 };
export const TEAM_SIZE = TEAM.men + TEAM.women + TEAM.reserves;

// Punkty każdego zawodnika w jednym konkursie (bez mnożnika kapitana).
// Zwraca Map athleteId -> { place, longest, quali, record, total }
export function racePoints(race, result, settings, hillRecordIds = []) {
  const placePts = settings.placePoints || FIS_POINTS;
  const bonus = { ...DEFAULT_BONUS, ...(settings.bonus || {}) };
  const out = new Map();
  if (!result) return out;
  const get = (id) => {
    if (!out.has(id)) out.set(id, { place: 0, longest: 0, quali: 0, record: 0, total: 0 });
    return out.get(id);
  };

  if (race.category === 'QUA') {
    for (const r of result.results) if (r.rank === 1) get(r.id).quali = bonus.quali;
  } else {
    for (const r of result.results) {
      if (r.rank && r.rank <= placePts.length) get(r.id).place = placePts[r.rank - 1];
    }
    // najdłuższy skok konkursu (wszystkie serie konkursu głównego); remis = wszyscy dostają bonus
    const max = Math.max(0, ...result.results.flatMap((r) => r.jumps || []));
    if (max > 0) {
      for (const r of result.results) if ((r.jumps || []).includes(max)) get(r.id).longest = bonus.longest;
    }
    for (const id of hillRecordIds) get(id).record = bonus.record;
  }
  for (const p of out.values()) p.total = p.place + p.longest + p.quali + p.record;
  return out;
}

export function longestJump(result) {
  return Math.max(0, ...(result?.results || []).flatMap((r) => r.jumps || []));
}

// ---------------------------------------------------------------- weekendy

// Weekend = grupa zawodów PŚ (M i K), których terminy na siebie zachodzą.
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
      // bez godziny (przed zawodami) kwalifikacje danego dnia idą przed konkursem
      .sort((a, b) => (a.date + (a.time || '') + (a.category === 'QUA' ? 0 : 1))
        .localeCompare(b.date + (b.time || '') + (b.category === 'QUA' ? 0 : 1)));
  });
  return weekends;
}

// Skład zablokowany od północy pierwszego dnia weekendu (czas lokalny przeglądarki).
export function isLocked(weekend, now = new Date()) {
  return now >= new Date(weekend.start + 'T00:00:00');
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
  for (let i = weekends.findIndex((w) => w.id === weekendId); i >= 0; i--) {
    const l = lineups[weekends[i].id]?.[pid];
    if (l) {
      const starters = l.starters.filter((id) => teamIds.includes(id));
      // kapitan przechodzi tylko, jeśli ustawiono go na ten konkretny weekend
      return { starters, captain: i === weekends.findIndex((w) => w.id === weekendId) ? l.captain : null, inherited: weekends[i].id !== weekendId };
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

// Mistrzostwa Świata liczą się do ligi, chyba że admin to wyłączy.
export const countsForLeague = (race, settings) => !race.champ || settings.countChamps !== false;

// Punkty wszystkich uczestników we wszystkich konkursach.
// Zwraca { byRace: {raceId: {pid: {total, athletes: [{id, pts, captain}]}}}, byWeekend, totals, athleteTotals }
export function computeAll(state, weekends, results, athletesById) {
  const settings = state.settings || {};
  const tm = teams(state);
  const byRace = {};
  const byWeekend = {};
  const totals = {};
  const athleteTotals = {};
  for (const p of state.participants || []) totals[p.id] = 0;

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
      const pts = racePoints(race, res, settings, state.hillRecords?.[race.id] || []);
      byRace[race.id] = {};
      for (const p of state.participants || []) {
        const l = lineups[p.id];
        const entry = { total: 0, athletes: [] };
        for (const aid of l.starters) {
          const ap = pts.get(aid);
          if (!ap || !ap.total) continue;
          const cap = l.captain === aid;
          const v = ap.total * (cap ? 2 : 1);
          entry.total += v;
          entry.athletes.push({ id: aid, pts: v, base: ap, captain: cap });
          athleteTotals[aid] = (athleteTotals[aid] || 0) + v;
        }
        byRace[race.id][p.id] = entry;
        byWeekend[w.id][p.id] += entry.total;
        totals[p.id] += entry.total;
      }
    }
  }
  return { byRace, byWeekend, totals, athleteTotals, teams: tm };
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
