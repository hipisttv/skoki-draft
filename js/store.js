// Wspólny stan ligi (uczestnicy, draft, składy, kapitanowie).
// Z konfiguracją Firebase – zapis w Firestore, widoczny na żywo dla wszystkich.
// Bez niej – zapis tylko w tej przeglądarce (tryb testowy).
import { firebaseConfig, leagueId } from '../firebase-config.js';

export const EMPTY_STATE = {
  setup: null,          // { leagueName, salt, adminUser, adminHash, invite, maxPlayers, created }
  draftStarted: false,
  participants: [],     // { id, name (login), team, passHash, color, photo?, joined }
  draftOrder: [],
  picks: [],
  lineups: {},
  triples: {},          // { pid: raceId } – mnożnik ×3, raz w sezonie
  draws: [],            // [{ at, order }] – historia losowań kolejności draftu (jawna dla wszystkich)
  hillRecords: {},
  reactions: {},        // { weekendId: { pid: { emoji: [pid, …] } } } – reakcje pod składami
  raceReactions: {},    // { raceId: { emoji: [pid, …] } } – reakcje pod wynikami konkursu
  raceComments: {},     // { raceId: [{ id, pid, text, at }] } – komentarze pod wynikami
  skokdle: {},          // { 'RRRR-MM-DD': { pid: { a: próby | 'x', h: próby | 'x' } } } – wyniki codziennej zagadki
  settings: {},
};

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
const LEAGUE = leagueId || 'main';

export async function createStore(onChange) {
  if (firebaseConfig) return firestoreStore(onChange);
  return localStore(onChange);
}

function normalize(s) {
  return { ...EMPTY_STATE, ...(s || {}) };
}

// Obecność graczy („kto ma teraz otwartą aplikację i na której zakładce”) trzymamy w osobnym
// dokumencie – częste sygnały nie kolidują wtedy z zapisami draftu.
async function firestoreStore(onChange) {
  const { initializeApp } = await import(`${FB}/firebase-app.js`);
  const fs = await import(`${FB}/firebase-firestore.js`);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const ref = fs.doc(db, 'leagues', LEAGUE);
  const presenceRef = fs.doc(db, 'leagues', `${LEAGUE}-presence`);
  fs.onSnapshot(ref, (snap) => onChange(normalize(snap.data()?.state && JSON.parse(snap.data().state))));
  return {
    mode: 'firebase',
    // fn dostaje kopię stanu i zwraca nowy stan; transakcja chroni przed jednoczesnym wyborem
    async update(fn) {
      await fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = normalize(snap.exists() && snap.data().state ? JSON.parse(snap.data().state) : null);
        const next = fn(structuredClone(cur));
        tx.set(ref, { state: JSON.stringify(next), updated: Date.now() });
      });
    },
    heartbeat(pid, view, t = Date.now()) {
      return fs.setDoc(presenceRef, { [pid]: { t: t || Date.now(), view } }, { merge: true }).catch(() => {});
    },
    onPresence(cb) {
      fs.onSnapshot(presenceRef, (snap) => cb(snap.data() || {}));
    },
  };
}

function localStore(onChange) {
  const KEY = `skoki-draft-state-${LEAGUE}`;
  const PKEY = `skoki-presence-${LEAGUE}`;
  const read = () => {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch { return normalize(null); }
  };
  const readP = () => {
    try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; }
  };
  let presenceCb = null;
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) onChange(read());
    if (e.key === PKEY && presenceCb) presenceCb(readP());
  });
  setTimeout(() => onChange(read()));
  return {
    mode: 'local',
    async update(fn) {
      const next = fn(structuredClone(read()));
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* brak miejsca / tryb prywatny */ }
      onChange(normalize(next));
    },
    heartbeat(pid, view, t = Date.now()) {
      const p = readP();
      p[pid] = { t: t || Date.now(), view };
      try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* ignoruj */ }
      if (presenceCb) presenceCb(p);
    },
    onPresence(cb) {
      presenceCb = cb;
      setTimeout(() => cb(readP()));
    },
  };
}
