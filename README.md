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
1. **Admin otwiera ligę:** pierwsza osoba, która wejdzie na stronę, podaje nazwę ligi i **hasło administratora**.
   Do tego czasu nikt inny nie może się zapisać.
2. Admin klika u góry swoje imię → **Dołącz jako gracz** (jeśli też gra) i wysyła znajomym link.
3. **Gracze się zapisują:** każdy wpisuje imię i wymyśla PIN (4–8 cyfr) – PIN-em loguje się potem na telefonie i komputerze.
4. Admin w **Panelu admina** ustawia kolejność (albo **Losuj**) i klika **Rozpocznij draft** – zapisy się zamykają.
5. Draft odbywa się na żywo, każdy na swoim urządzeniu. Kto akurat wybiera, widzi „Twoja kolej!”.
6. Przed każdym weekendem każdy w zakładce **Drużyny** wybiera kapitana (przycisk **C**) i ewentualnie wstawia rezerwowego.

Zapomniany PIN admin ustawia na nowo w Panelu admina (ikona klucza przy graczu).

## Co jest w aplikacji

- **Ranking** – tabela ligi, wykres przebiegu sezonu, punkty w każdym weekendzie, najlepsi zawodnicy, statystyki kapitanów.
- **Drużyny** – składy wszystkich graczy na wybrany weekend, kapitanowie, punkty; edycja własnego składu.
- **Kalendarz** – wszystkie weekendy PŚ; po kliknięciu konkursu: pełne wyniki z odległościami, kto ma którego zawodnika,
  punkty każdej drużyny i rozbicie na miejsce / bonusy / kapitana.
- **Puchar Świata** – klasyfikacja generalna mężczyzn i kobiet (bieżąca liczona z wyników FIS, zeszłoroczna z FIS) z informacją, kto ma zawodnika.
- **Draft** – tablica draftu na żywo i lista zawodników z filtrami.
- **Zawodnicy** – ile punktów ligi zdobywa każdy skoczek, także wolni.
- **Panel admina** – gracze, kolejność i start draftu, cofanie wyborów, punktacja, kopia zapasowa.

## Zasady zaimplementowane w aplikacji

- Drużyna: 9 zawodników = 6 mężczyzn + 1 kobieta w składzie + 2 rezerwowych (dowolnej płci). Punktują tylko zawodnicy ze składu.
- Snake draft (1–2–3–3–2–1…), każdy zawodnik tylko w jednej drużynie.
- **Konkursy PŚ:** punkty za miejsce wg punktacji PŚ FIS (100, 80, 60 … 1 za 30. miejsce).
- **Mistrzostwa Świata (Falun 2027):** złoto 500, srebro 300, brąz 200, miejsca 4–10 po 50 pkt. W kalendarzu wyróżnione na złoto.
  MŚ trwają dwa weekendy, więc to dwie rundy z osobnym kapitanem.
- **Kwalifikacje:** nie ma punktów za miejsce – liczy się tylko zwycięstwo w kwalifikacjach (+5) i rekord skoczni (+15).
- **Bonusy** (sumują się z punktami za miejsce): najdłuższy skok konkursu +10 (tylko konkurs główny, wszystkie serie,
  remis = obaj), rekord skoczni +15.
- **Kapitan** ×2 za wszystko w danym weekendzie. Wybierany przed weekendem, nie można go zmienić w trakcie.
- **Kara −20 pkt**, gdy kapitan skończy konkurs PŚ lub MŚ (swojej płci) poza czołową 30 – także gdy odpadnie w kwalifikacjach
  lub nie wystartuje.
- **Mnożnik ×3 raz w sezonie:** każdy wybiera jeden konkurs PŚ (nie kwalifikacje i nie MŚ) i wszystkie punkty jego drużyny w tym
  konkursie – razem z kapitanem i karą – są mnożone przez 3. Ustawia się go w zakładce Drużyny i można zmieniać
  aż do startu wybranego konkursu (godzina z FIS w czasie lokalnym skoczni; dopóki FIS jej nie poda – do północy w dniu konkursu).
- **Rekord skoczni** wykrywany jest automatycznie z oficjalnego protokołu FIS (PDF z wynikami): skok dłuższy od rekordu
  albo rekord z datą tego konkursu. Wyrównanie rekordu nie jest nowym rekordem. Admin może to poprawić w widoku konkursu
  (np. gdy skok z upadkiem nie został uznany).
- Skład i kapitana można zmieniać do **minuty przed startem pierwszych kwalifikacji weekendu** (godzina z FIS w czasie
  lokalnym skoczni; dopóki FIS jej nie poda – do północy przed pierwszym dniem), potem są zablokowane.
- Pełne zasady są w aplikacji w zakładce **Zasady** (dostępnej też przed zalogowaniem).
- Liczone są tylko konkursy indywidualne – bez drużynówek, duetów i mikstów.
- Dni i godziny startu pochodzą z oficjalnych programów zawodów FIS (PDF „Event Program”) – baza FIS
  ma kwalifikacje pod datą konkursu, a program ma prawdziwy dzień. W aplikacji wyświetlane są w czasie polskim.
- Wszystkie wartości punktowe admin może zmienić w Panelu admina → Punktacja (również wyłączyć liczenie MŚ).

## Lista zawodników

`data/athletes.json` – **wszyscy skoczkowie ze statusem Active w bazie FIS** (ok. 1350 osób), posortowani wg punktów
PŚ z zeszłego sezonu, potem Pucharu Kontynentalnego i Letniego Grand Prix. `data/photos/` – portrety ok. 190 najlepszych
zawodników z FIS (pozostali mają inicjały). Listę odświeża się ręcznie (Actions → Run workflow → „Odśwież też listę
zawodników”) – najlepiej tylko przed draftem.

## Lokalnie

```bash
python scraper/fis.py            # pobierz dane bieżącego sezonu do data/
python -m http.server 8080       # potem otwórz http://localhost:8080
```
