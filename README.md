# 🎿 Draft Skoków

Aplikacja do draftu skoczków narciarskich na sezon Pucharu Świata: snake draft, składy z kapitanem
na każdy weekend, automatyczne pobieranie wyników z FIS i liczenie punktów, kalendarz z wynikami.

## Jak to działa

| Część | Gdzie | Koszt |
|---|---|---|
| Strona (HTML/JS) | GitHub Pages | 0 zł |
| Pobieranie wyników FIS | GitHub Actions (co 2 h, w weekendy co 30 min) | 0 zł |
| Wspólne dane ligi (draft, składy, kapitanowie) | Firebase Firestore (plan Spark) | 0 zł |

Wyniki z FIS zapisywane są w `data/` jako JSON, a punkty liczy przeglądarka – więc po zmianie
punktacji w Ustawieniach wszystko przelicza się od razu, także wstecz.

## Uruchomienie (jednorazowo, ~15 min)

### 1. Firebase (wspólna baza dla Was trojga)
1. Wejdź na https://console.firebase.google.com → **Add project** (np. `skoki-draft`), Analytics można wyłączyć.
2. **Build → Firestore Database → Create database** → wybierz region `eur3` → tryb **production**.
3. Zakładka **Rules**, wklej i opublikuj:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /leagues/{league} {
         allow read, write: if true;
       }
     }
   }
   ```
   (Każdy, kto zna adres strony, może zmieniać dane ligi – dla zabawy wśród znajomych to wystarczy.
   Na wszelki wypadek w Ustawieniach jest „Pobierz stan ligi” do kopii zapasowej.)
4. **Project settings (⚙) → Your apps → Web (`</>`)** → zarejestruj aplikację → skopiuj obiekt `firebaseConfig`
   i wklej go do pliku `firebase-config.js` w miejsce `null`.

### 2. GitHub
1. Załóż repozytorium (może być publiczne) i wrzuć do niego ten folder.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Actions → „Wyniki FIS + strona” → Run workflow** – pierwsze uruchomienie pobierze dane i opublikuje stronę.
4. Strona będzie pod adresem `https://<twoj-login>.github.io/<nazwa-repo>/`.

### 3. Liga
1. Wejdź na stronę → **Ustawienia** → dodaj uczestników → **Losuj kolejność**.
2. Każdy wybiera u góry „Jestem: …” i robicie **Draft** (na żywo, każdy na swoim telefonie/komputerze).
3. Przed każdym weekendem każdy w zakładce **Drużyny** wybiera kapitana (🧢) i ewentualnie wstawia rezerwowego.

## Zasady zaimplementowane w aplikacji

- Drużyna: 9 zawodników = 6 mężczyzn + 1 kobieta w składzie + 2 rezerwowych (dowolnej płci).
- Snake draft (1–2–3–3–2–1…), każdy zawodnik tylko w jednej drużynie.
- Punkty za miejsce: punktacja PŚ FIS (100, 80, 60, 50, 45, 40, 36, 32, 29, 26 … 1 za 30. miejsce) – do zmiany w Ustawieniach.
- Bonusy: wygrane kwalifikacje +5, najdłuższy skok konkursu +10 (tylko konkurs główny, wszystkie serie, remis = obaj),
  rekord skoczni +15. Bonusy sumują się z punktami za miejsce.
- Kapitan ×2 za wszystko w danym weekendzie. Punktują tylko zawodnicy ze składu (rezerwowi nie).
- Weekend = zawody PŚ mężczyzn i kobiet, których terminy się pokrywają (np. Ruka + Hinzenbach).
- Skład i kapitana można zmieniać do północy przed pierwszym dniem weekendu (pierwsze kwalifikacje), potem są zablokowane.
- Punktowane są konkursy indywidualne PŚ i kwalifikacje do nich (bez drużynówek i mikstów).
- **Rekord skoczni** nie jest oznaczany w danych FIS, więc zaznacza się go ręcznie w widoku konkursu
  (przycisk „Oznacz rekord skoczni”) – dopiero gdy rekord zostanie oficjalnie uznany.

## Lista zawodników

`data/athletes.json` – wszyscy z punktami w PŚ w zeszłym sezonie oraz w tegorocznym Letnim Grand Prix,
posortowani wg punktów PŚ z zeszłego sezonu. Zawodnicy, którzy wystartują w PŚ w tym sezonie, a nie ma ich na liście,
są dopisywani automatycznie.

## Lokalnie

```bash
python scraper/fis.py            # pobierz dane bieżącego sezonu do data/
python -m http.server 8080       # potem otwórz http://localhost:8080
```

`http://localhost:8080/?data=demo` pokazuje aplikację na wynikach sezonu 2025/26 (folder `demo/`) – przydatne do
przetestowania punktacji, zanim ruszy nowy sezon.
