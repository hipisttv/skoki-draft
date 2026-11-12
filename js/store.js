// Wspólny stan ligi (uczestnicy, draft, składy, kapitanowie).
// Z konfiguracją Firebase – zapis w Firestore, widoczny na żywo dla wszystkich.
// Bez niej – zapis tylko w tej przeglądarce (tryb testowy).
import { firebaseConfig, leagueId } from '../firebase-config.js';

export const EMPTY_STATE = {
  setup: null,          // { leagueName, salt, adminHash, created } – liga otwarta przez admina
  draftStarted: false,
  participants: [],     // { id, name, pinHash, color, joined }
  draftOrder: [],
  picks: [],
  lineups: {},
  hillRecords: {},
  settings: {},
};

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function createStore(onChange) {
  if (firebaseConfig) return firestoreStore(onChange);
  return localStore(onChange);
}

function normalize(s) {
  return { ...EMPTY_STATE, ...(s || {}) };
}

async function firestoreStore(onChange) {
  const { initializeApp } = await import(`${FB}/firebase-app.js`);
  const fs = await import(`${FB}/firebase-firestore.js`);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const ref = fs.doc(db, 'leagues', leagueId || 'main');
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
  };
}

function localStore(onChange) {
  const KEY = 'skoki-draft-state-' + (leagueId || 'main');
  const read = () => {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch { return normalize(null); }
  };
  window.addEventListener('storage', (e) => { if (e.key === KEY) onChange(read()); });
  setTimeout(() => onChange(read()));
  return {
    mode: 'local',
    async update(fn) {
      const next = fn(structuredClone(read()));
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* brak miejsca / tryb prywatny */ }
      onChange(normalize(next));
    },
  };
}
