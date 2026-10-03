// Holt die Angebote für alle Einträge der Merkliste und schreibt sie als angebote.json
// für die statische Fassung auf GitHub Pages.
// Aufruf: node tools/aktualisieren.js <zielordner>
const fs = require("fs");
const path = require("path");
const { suche, lies, MERKLISTE, EINSTELLUNGEN } = require("../angebote");

(async () => {
  const ziel = process.argv[2] || ".";
  const einstellungen = lies(EINSTELLUNGEN, {});
  const merkliste = lies(MERKLISTE, []).map((e) => (typeof e === "object" ? e.name : e));

  const eintraege = [];
  for (const name of merkliste) {
    const { angebote } = await suche(name);
    console.log(`${name}: ${angebote.length} Angebot(e)`);
    eintraege.push({ name, angebote });
  }

  fs.mkdirSync(ziel, { recursive: true });
  fs.writeFileSync(path.join(ziel, "angebote.json"), JSON.stringify({
    stand: new Date().toISOString(),
    einstellungen,
    merkliste: eintraege,
  }));
})().catch((e) => { console.error(e); process.exit(1); });
