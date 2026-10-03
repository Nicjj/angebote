// Gemeinsame Suchlogik für den lokalen Server (server.js) und die GitHub Action (tools/aktualisieren.js):
// fragt kaufDA und marktguru für die eingestellten Orte ab und führt die Treffer zusammen.
const fs = require("fs");
const path = require("path");
const wortschatz = require("./wortschatz");

const ORDNER = __dirname;
const MERKLISTE = path.join(ORDNER, "merkliste.json");
const EINSTELLUNGEN = path.join(ORDNER, "einstellungen.json");
const CACHE_MINUTEN = 30;
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

function lies(datei, standard) {
  try { return JSON.parse(fs.readFileSync(datei, "utf8")); } catch { return standard; }
}
function schreib(datei, daten) {
  fs.writeFileSync(datei, JSON.stringify(daten, null, 2) + "\n", "utf8");
}

// ---------- kaufDA ----------

const umlaute = (s) => s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
  .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss");
const normal = (s) => umlaute(String(s).toLowerCase());
const gross = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const FUELLWOERTER = new Set(["von", "de", "der", "die", "das", "und", "mit", "im", "in", "oder", "je"]);

// Ein Merklisten-Eintrag: unter welchen kaufDA-Adressen gesucht wird (suche)
// und welche Wörter im Angebot vorkommen müssen (muss).
// Für frei eingetippte Begriffe wird das hier geraten.
function autoEintrag(text) {
  const woerter = text.trim().split(/\s+/).filter(Boolean);
  const wichtig = woerter.filter((w) => w.length >= 3 && !/\d/.test(w) && !FUELLWOERTER.has(w.toLowerCase()));
  // kaufDA kennt Produkte nur unter festen Adressen wie /Angebote/Coca-Cola
  const suche = [
    woerter.map(gross).join("-"),
    umlaute(woerter.map(gross).join("-")),
    ...wichtig.map((w) => umlaute(gross(w))),
  ];
  return { name: text.trim(), suche: [...new Set(suche)].slice(0, 5), muss: wichtig.map(normal) };
}

function eintragFuer(text) {
  const gespeichert = lies(MERKLISTE, []).find((e) => typeof e === "object" && normal(e.name) === normal(text));
  return gespeichert || autoEintrag(text);
}

// kaufDA bittet in robots.txt um 2 s Abstand zwischen Abrufen. Die Action setzt KAUFDA_ABSTAND_MS=2000,
// lokal laufen die Abrufe ohne Pause.
const ABSTAND_MS = Number(process.env.KAUFDA_ABSTAND_MS || 0);
let warteschlange = Promise.resolve();
function nacheinander(fn) {
  if (!ABSTAND_MS) return fn();
  const lauf = warteschlange.then(fn);
  warteschlange = lauf.catch(() => {}).then(() => new Promise((r) => setTimeout(r, ABSTAND_MS)));
  return lauf;
}

async function kaufdaSeite(slug, ort) {
  return nacheinander(() => kaufdaSeiteHolen(slug, ort));
}

async function kaufdaSeiteHolen(slug, ort) {
  const cookie = "location=" + encodeURIComponent(JSON.stringify({
    lat: ort.lat, lng: ort.lng, city: ort.name, zip: ort.plz, countryCode: "DE",
  }));
  const antwort = await fetch("https://www.kaufda.de/Angebote/" + encodeURIComponent(slug), {
    headers: { "user-agent": BROWSER, accept: "text/html", cookie },
    redirect: "manual",
  });
  if (antwort.status !== 200) return null;
  const html = await antwort.text();
  const treffer = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!treffer) return null;
  const angebote = JSON.parse(treffer[1]).props?.pageProps?.pageInformation?.offers;
  if (!angebote) return null;
  return [...(angebote.main?.items || []), ...(angebote.otherPublishers?.items || [])];
}

function vonKaufda(o, ort) {
  const p = o.prices || {};
  if (o.parentContent?.type !== "dynamic_brochure") {
    for (const pfad of o.categoryPaths || []) wortschatz.lerneKategoriepfad(pfad);
    if (o.brand) wortschatz.lernen(o.brand, "");
  }
  return {
    id: "kd-" + o.id,
    quelle: "kaufDA",
    laden: o.publisherName,
    titel: [o.brand, o.title].filter(Boolean).join(" "),
    beschreibung: o.description || "",
    preis: p.mainPrice || null,
    alterPreis: p.secondaryPrice || null,
    alterPreisUVP: !!p.secondaryPriceIsUVP,
    grundpreis: (p.priceByBaseUnit || "").replace(/[()]/g, "").replace(/(\d)\.(\d)/g, "$1,$2"),
    hinweis: p.description || "",
    von: o.validFrom ? o.validFrom.replace("+0000", "Z") : null,
    bis: o.validUntil ? o.validUntil.replace("+0000", "Z") : null,
    bild: o.offerImages?.url?.normal || o.offerImages?.url?.thumbnail || null,
    orte: [ort.name],
    // Nur Lebensmittel und Getränke aus echten Prospekten. „dynamic_brochure“ sind Online-Shop-Kataloge
    // (z. B. Höffners Sofa „Corona“, dort sogar als Bier einsortiert) und keine Wochenangebote.
    lebensmittel: o.parentContent?.type !== "dynamic_brochure"
      && (!o.categoryPaths?.length || o.categoryPaths.some((p) => p[0]?.name === "Lebensmittel und Getränke")),
    suchtext: (o.categories || []).join(" "),
  };
}

async function sucheKaufda(eintrag, orte) {
  const abrufe = eintrag.suche.flatMap((slug) => orte.map((ort) =>
    kaufdaSeite(slug, ort).then((items) => (items || []).map((o) => vonKaufda(o, ort))).catch(() => [])));
  return (await Promise.all(abrufe)).flat();
}

// ---------- marktguru ----------

let mgSchluessel = null;
async function marktguruSchluessel(neu = false) {
  if (mgSchluessel && !neu) return mgSchluessel;
  const html = await (await fetch("https://www.marktguru.de/", { headers: { "user-agent": BROWSER } })).text();
  const json = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
  const config = JSON.parse(json[1]).config;
  mgSchluessel = { "x-apikey": config.apiKey, "x-clientkey": config.clientKey };
  return mgSchluessel;
}

async function marktguruAbfrage(begriff, plz, zweiterVersuch = false) {
  const url = "https://api.marktguru.de/api/v1/offers/search?as=web&limit=100&offset=0&q="
    + encodeURIComponent(begriff) + "&zipCode=" + plz;
  const antwort = await fetch(url, { headers: { ...(await marktguruSchluessel(zweiterVersuch)), "user-agent": BROWSER } });
  if ((antwort.status === 401 || antwort.status === 403) && !zweiterVersuch) return marktguruAbfrage(begriff, plz, true);
  if (!antwort.ok) return [];
  return (await antwort.json()).results || [];
}

function vonMarktguru(o, ort) {
  const gueltig = (o.validityDates || [])[0] || {};
  if (o.brand?.name) wortschatz.lernen(o.brand.name, (o.categories || [])[0]?.name || "");
  return {
    id: "mg-" + o.id,
    quelle: "marktguru",
    laden: (o.advertisers || [])[0]?.name || "?",
    titel: o.brand?.name && o.product?.name && o.brand.name.toLowerCase().includes(o.product.name.toLowerCase())
      ? o.brand.name
      : [o.brand?.name, o.product?.name].filter(Boolean).join(" "),
    beschreibung: o.description || "",
    preis: o.price || null,
    alterPreis: o.oldPrice || null,
    grundpreis: o.referencePrice && o.unit ? "1 " + o.unit.shortName + " = " + o.referencePrice.toFixed(2).replace(".", ",") + " EUR" : "",
    hinweis: o.requiresLoyalityMembership ? "nur mit Kundenkarte" : "",
    von: gueltig.from || null,
    bis: gueltig.to || null,
    bild: "https://mg2de.b-cdn.net/api/v1/offers/" + o.id + "/images/default/0/medium.jpg",
    orte: [ort.name],
  };
}

async function sucheMarktguru(eintrag, orte) {
  const begriff = eintrag.marktguru || eintrag.muss.join(" ") || eintrag.name;
  const ergebnisse = await Promise.all(orte.map((ort) =>
    marktguruAbfrage(begriff, ort.plz).then((r) => r.map((o) => vonMarktguru(o, ort))).catch(() => [])));
  return ergebnisse.flat();
}

// ---------- Zusammenführen ----------

const cache = new Map();

function passtZumEintrag(angebot, eintrag) {
  const text = normal(angebot.titel + " " + angebot.beschreibung + " " + (angebot.suchtext || ""));
  return eintrag.muss.every((w) => text.includes(normal(w)));
}

async function suche(begriff) {
  const eintrag = eintragFuer(begriff);
  const schluessel = JSON.stringify(eintrag);
  const alt = cache.get(schluessel);
  if (alt && Date.now() - alt.zeit < CACHE_MINUTEN * 60000) return alt.daten;

  const { orte, getraenkehandel } = lies(EINSTELLUNGEN, { orte: [] });
  const [kd, mg] = await Promise.all([sucheKaufda(eintrag, orte), sucheMarktguru(eintrag, orte)]);
  const jetzt = Date.now();
  // Getränkehändler stellen ihre ganze Preisliste ein. Dort zählt nur, was einen Streichpreis hat.
  const istGetraenkehandel = (laden) => getraenkehandel && new RegExp(getraenkehandel, "i").test(laden);

  // Gleiches Angebot aus mehreren Orten oder aus beiden Quellen nur einmal zeigen.
  const zusammen = new Map();
  for (const a of [...kd, ...mg]) {
    if (a.bis && new Date(a.bis).getTime() < jetzt) continue;
    // ohne Preis sind das Bonus-Aktionen u. Ä., keine Produktangebote
    if (!a.preis || a.lebensmittel === false || !passtZumEintrag(a, eintrag)) continue;
    a.reduziert = !!(a.alterPreis && a.preis && a.alterPreis > a.preis);
    if (istGetraenkehandel(a.laden) && !a.reduziert) continue;
    const key = a.laden.toLowerCase() + "|" + (a.preis ?? a.id);
    const da = zusammen.get(key);
    if (da) { for (const o of a.orte) if (!da.orte.includes(o)) da.orte.push(o); }
    else { const { suchtext, lebensmittel, ...rest } = a; zusammen.set(key, { ...rest, orte: [...a.orte] }); }
  }
  const daten = {
    begriff,
    abgerufen: new Date().toISOString(),
    angebote: [...zusammen.values()].sort((a, b) => (a.preis ?? 1e9) - (b.preis ?? 1e9)),
  };
  cache.set(schluessel, { zeit: Date.now(), daten });
  return daten;
}

module.exports = { suche, eintragFuer, lies, schreib, MERKLISTE, EINSTELLUNGEN, wortschatz };
