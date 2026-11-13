// Konfiguracja projektu Firebase (Project settings → Your apps → Web app).
// Te dane nie są tajne – identyfikują projekt; dostęp do danych określają reguły Firestore.
// Ustawienie null przełącza aplikację w tryb testowy (dane tylko w tej przeglądarce).
export const firebaseConfig = {
  apiKey: 'AIzaSyDYDyqbiTMYgqoJ0XyPTxJtxV2IPQCbxkc',
  authDomain: 'skoki-draft-43cdb.firebaseapp.com',
  projectId: 'skoki-draft-43cdb',
  storageBucket: 'skoki-draft-43cdb.firebasestorage.app',
  messagingSenderId: '333364916109',
  appId: '1:333364916109:web:4e2817eb3e35d4543597c4',
};

// Nazwa ligi – zmień, jeśli chcecie prowadzić kilka lig na jednej bazie.
export const leagueId = 'main';
