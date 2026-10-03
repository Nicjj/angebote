// Wortschatz für „Meinten Sie …?“: bekannte Produkte und Marken samt Art („Bier“, „Marke“ …).
// Grundstock aus wortschatz-basis.json, dazu lernt er aus jedem abgerufenen Angebot.
const fs = require("fs");
const path = require("path");

const BASIS = path.join(__dirname, "wortschatz-basis.json");
const GELERNT = path.join(__dirname, "wortschatz.json");

const normal = (s) => String(s).toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const eintraege = new Map(); // normal(name) → { name, art }
let geaendert = false;

function laden(datei) {
  try {
    for (const [name, art] of Object.entries(JSON.parse(fs.readFileSync(datei, "utf8")))) aufnehmen(name, art);
  } catch {}
}

function aufnehmen(name, art) {
  name = String(name || "").trim();
  if (name.length < 3 || name.length > 40 || /\d/.test(name)) return false;
  const key = normal(name);
  if (!key) return false;
  const da = eintraege.get(key);
  if (da && (da.art || !art)) return false;
  eintraege.set(key, { name, art: art || da?.art || "" });
  return true;
}

laden(BASIS);
laden(GELERNT);

function lernen(name, art) {
  if (aufnehmen(name, art)) geaendert = true;
}

// kaufDA-Kategoriepfad, z. B. „… > Bier > Biermarken > Corona > Corona Extra“:
// jeder Knoten wird ein Wort, die Art ist der nächste sinnvolle Oberbegriff.
function lerneKategoriepfad(knoten) {
  const namen = knoten.map((k) => k.name);
  const istMarkenzweig = namen.some((n) => n === "Marken");
  namen.forEach((name, i) => {
    if (i < 2 || /^marken|marken$|^produkte$|^.$/i.test(name)) return;
    let art = istMarkenzweig ? "Marke" : "";
    for (let j = i - 1; j >= 2 && !art; j--) {
      if (!/marken|^produkte$|^.$/i.test(namen[j])) art = namen[j];
    }
    lernen(name, art);
  });
}

setInterval(() => {
  if (!geaendert) return;
  geaendert = false;
  const basis = (() => { try { return JSON.parse(fs.readFileSync(BASIS, "utf8")); } catch { return {}; } })();
  const neu = {};
  for (const { name, art } of eintraege.values()) if (!(name in basis)) neu[name] = art;
  fs.writeFileSync(GELERNT, JSON.stringify(neu, null, 1) + "\n", "utf8");
}, 10000).unref();

// ---------- Ähnlichkeit ----------

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Kölner Phonetik: gleich klingende deutsche Wörter bekommen denselben Code („Korona“ = „Corona“)
function phonetik(wort) {
  const w = normal(wort).replace(/ /g, "").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  let code = "";
  for (let i = 0; i < w.length; i++) {
    // „#“ statt Leerstring, weil "abc".includes("") immer true ist
    const c = w[i], v = w[i - 1] || "#", n = w[i + 1] || "#";
    let z = "";
    if ("aeijouy".includes(c)) z = "0";
    else if (c === "h") z = "";
    else if (c === "b") z = "1";
    else if (c === "p") z = n === "h" ? "3" : "1";
    else if ("dt".includes(c)) z = "csz".includes(n) ? "8" : "2";
    else if ("fvw".includes(c)) z = "3";
    else if ("gkq".includes(c)) z = "4";
    else if (c === "c") {
      if (i === 0) z = "ahkloqrux".includes(n) ? "4" : "8";
      else z = "sz".includes(v) ? "8" : "ahkoqux".includes(n) ? "4" : "8";
    } else if (c === "x") z = "ckq".includes(v) ? "8" : "48";
    else if (c === "l") z = "5";
    else if ("mn".includes(c)) z = "6";
    else if (c === "r") z = "7";
    else if ("sz".includes(c)) z = "8";
    code += z;
  }
  code = code.replace(/(.)\1+/g, "$1");
  return code[0] + code.slice(1).replace(/0/g, "");
}

function aehnlichkeit(eingabe, kandidat) {
  const a = normal(eingabe), b = normal(kandidat);
  if (!a || !b) return 0;
  const abstand = levenshtein(a, b) / Math.max(a.length, b.length);
  let wert = 1 - abstand;
  // Gleicher Klang zählt hoch, bei Gleichstand gewinnt die ähnlichere Schreibweise
  if (a.length >= 3 && phonetik(a) === phonetik(b)) wert = Math.max(wert, 0.85 + wert * 0.1);
  return wert;
}

const FUELL = new Set(["von", "de", "der", "die", "das", "und", "mit", "im", "in", "oder", "je", "la", "le", "il"]);
const ALLGEMEIN = new Set(["suess", "trocken", "halbtrocken", "light", "zero", "classic", "original", "extra", "bio",
  "rot", "weiss", "rosso", "bianco", "groß", "gross", "klein", "flasche", "dose", "kasten", "liter", "pack"]);

function bekanntesWort(w) {
  const n = normal(w);
  if (FUELL.has(n) || ALLGEMEIN.has(n) || n.length < 3 || /\d/.test(n)) return true;
  if (eintraege.has(n)) return true;
  for (const key of eintraege.keys()) if (key.split(" ").includes(n)) return true;
  return false;
}

// Liefert, ob die Eingabe bekannt ist, und sonst bis zu drei Vorschläge.
function pruefen(text) {
  const eingabe = normal(text);
  if (!eingabe) return { bekannt: false, vorschlaege: [] };
  if (eintraege.has(eingabe)) return { bekannt: true, vorschlaege: [] };
  const woerter = text.trim().split(/\s+/);
  if (woerter.every(bekanntesWort)) return { bekannt: true, vorschlaege: [] };

  const kandidaten = [];
  // 1. ganze Eingabe gegen ganze Einträge
  for (const e of eintraege.values()) {
    const wert = aehnlichkeit(text, e.name);
    if (wert >= 0.7) kandidaten.push({ text: e.name, art: e.art, wert });
  }
  // 2. jedes unbekannte Wort einzeln korrigieren („Barefood Moscato“ → „Barefoot Moscato“)
  if (woerter.length > 1) {
    let korrigiert = [], art = "", gesamt = 1, alleGefunden = true;
    for (const w of woerter) {
      if (bekanntesWort(w)) { korrigiert.push(w); continue; }
      let bester = null;
      for (const e of eintraege.values()) {
        for (const teil of e.name.split(/\s+/)) {
          const wert = aehnlichkeit(w, teil);
          if (wert >= 0.7 && (!bester || wert > bester.wert)) bester = { teil, wert, art: e.art };
        }
      }
      if (!bester) { alleGefunden = false; break; }
      korrigiert.push(bester.teil);
      gesamt = Math.min(gesamt, bester.wert);
      art = art || bester.art;
    }
    if (alleGefunden) kandidaten.push({ text: korrigiert.join(" "), art, wert: gesamt });
  }

  const gesehen = new Set();
  const vorschlaege = kandidaten
    .sort((a, b) => b.wert - a.wert)
    .filter((k) => { const n = normal(k.text); if (n === eingabe || gesehen.has(n)) return false; gesehen.add(n); return true; })
    .slice(0, 3)
    .map(({ text, art }) => ({ text, art }));
  return { bekannt: false, vorschlaege };
}

module.exports = { lernen, lerneKategoriepfad, pruefen, anzahl: () => eintraege.size };
