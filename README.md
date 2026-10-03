# Angebote

Zeigt, welche Produkte von der Merkliste diese Woche in Glashütte, Dippoldiswalde und Altenberg im Angebot sind.
Daten von kaufDA und marktguru.

- **live:** https://nicjj.github.io/angebote/
- **testing:** https://nicjj.github.io/angebote/test/

## Wie es läuft

Eine GitHub Action (`.github/workflows/pages.yml`) holt stündlich die Angebote für `merkliste.json`
und veröffentlicht sie zusammen mit `index.html` auf GitHub Pages. Gebaut werden immer beide Branches:
`live` als Hauptseite, `testing` unter `/test/`.

Änderungen kommen zuerst nach `testing` und werden erst auf Ansage nach `live` übernommen:

```
git checkout live && git merge --ff-only testing && git push && git checkout testing
```

## Dateien

- `merkliste.json`: Produkte; je Eintrag `suche` (kaufDA-Adressen) und `muss` (Wörter, die im Angebot stehen müssen)
- `einstellungen.json`: Orte, Lieblingsläden, Getränkehändler
- `angebote.js`: Suchlogik, `tools/aktualisieren.js`: schreibt `angebote.json` für Pages
- `server.js`: lokale Fassung mit Suchleiste und „Meintest du …?“ (`node server.js`, dann http://localhost:5610)
