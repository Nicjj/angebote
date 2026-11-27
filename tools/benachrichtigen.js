// Schickt eine E-Mail, sobald ein Artikel der Merkliste neu im Angebot ist.
// Jedes Angebot wird nur einmal gemeldet; gemeldete IDs merkt sich die Statusdatei.
// Aufruf: node tools/benachrichtigen.js <angebote.json> <statusdatei>
// Zugangsdaten kommen aus den Umgebungsvariablen MAIL_KONTO (Gmail-Adresse) und
// MAIL_PASSWORT (Gmail-App-Passwort). Fehlen sie, wird die Mail nur ausgegeben, nicht verschickt.
const fs = require("fs");

const [quelle, statusdatei] = process.argv.slice(2);
const daten = JSON.parse(fs.readFileSync(quelle, "utf8"));
let gemeldet = {};
try { gemeldet = JSON.parse(fs.readFileSync(statusdatei, "utf8")); } catch {}

// Abgelaufene Angebote vergessen, damit die Datei nicht wächst
const jetzt = Date.now();
for (const [id, bis] of Object.entries(gemeldet)) if (bis && Date.parse(bis) < jetzt - 86400000) delete gemeldet[id];

const neu = [];
for (const eintrag of daten.merkliste) {
  for (const a of eintrag.angebote) {
    if (gemeldet[a.id] !== undefined) continue;
    neu.push({ artikel: eintrag.name, ...a });
  }
}

const euro = (n) => (typeof n === "number" ? n.toFixed(2).replace(".", ",") + " €" : "");
const datum = (s) => (s ? new Date(s).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }) : "");
const html = (s) => String(s ?? "").replace(/[&<>"]/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[z]);

function mail(liste) {
  const erster = liste[0];
  const betreff = liste.length === 1
    ? `Im Angebot: ${erster.artikel} bei ${erster.laden} für ${euro(erster.preis)}`
    : `${liste.length} neue Angebote: ${[...new Set(liste.map((a) => a.artikel))].join(", ")}`;
  const zeilen = liste.map((a) => {
    const zeitraum = a.von || a.bis ? `${datum(a.von)} bis ${datum(a.bis)}` : "";
    const orte = (a.orte || []).join(", ");
    return `<tr>
      <td style="padding:8px;vertical-align:top">${a.bild ? `<img src="${html(a.bild)}" width="72" alt="">` : ""}</td>
      <td style="padding:8px;vertical-align:top">
        <b>${html(a.titel)}</b> bei <b>${html(a.laden)}</b><br>
        <span style="font-size:18px;color:#b00020"><b>${euro(a.preis)}</b></span>
        ${a.alterPreis ? `<s style="color:#777">${euro(a.alterPreis)}</s>` : ""}<br>
        <span style="color:#555">${html([a.beschreibung, a.grundpreis].filter(Boolean).join(" · ")).replace(/\n/g, " ")}</span><br>
        <span style="color:#555">${html([zeitraum, orte].filter(Boolean).join(" · "))}</span>
      </td></tr>`;
  }).join("");
  const text = liste.map((a) => `${a.titel} bei ${a.laden}: ${euro(a.preis)} (${datum(a.von)} bis ${datum(a.bis)})`).join("\n");
  return {
    betreff,
    text,
    html: `<div style="font-family:system-ui,sans-serif"><p>Neu im Angebot aus deiner Merkliste:</p>
      <table style="border-collapse:collapse">${zeilen}</table>
      <p style="color:#777;font-size:12px">Quelle: kaufDA und marktguru. Jedes Angebot wird nur einmal gemeldet.</p></div>`,
  };
}

(async () => {
  if (!neu.length) { console.log("Keine neuen Angebote."); return; }
  const m = mail(neu);
  const { MAIL_KONTO: konto, MAIL_PASSWORT: passwort } = process.env;
  if (!konto || !passwort) {
    console.log("MAIL_KONTO/MAIL_PASSWORT fehlen, Mail wird nicht verschickt:\n" + m.betreff + "\n" + m.text);
    return; // Status bleibt unverändert, damit nach dem Einrichten trotzdem gemeldet wird
  }
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user: konto, pass: passwort } });
  await transport.sendMail({ from: `Angebote <${konto}>`, to: konto, subject: m.betreff, text: m.text, html: m.html });
  console.log(`Mail verschickt: ${m.betreff}`);
  for (const a of neu) gemeldet[a.id] = a.bis || null;
  fs.writeFileSync(statusdatei, JSON.stringify(gemeldet));
})().catch((e) => { console.error(e.message); process.exit(1); });
