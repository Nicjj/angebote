// Lokale Fassung mit Suchleiste und bearbeitbarer Merkliste.
// Start: node server.js  →  http://localhost:5610
const http = require("http");
const fs = require("fs");
const path = require("path");
const { suche, eintragFuer, lies, schreib, MERKLISTE, EINSTELLUNGEN, wortschatz } = require("./angebote");

const PORT = 5610;

// ---------- HTTP ----------

function sende(res, status, daten, typ = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": typ, "cache-control": "no-store" });
  res.end(typeof daten === "string" || Buffer.isBuffer(daten) ? daten : JSON.stringify(daten));
}

function body(req) {
  return new Promise((ok) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/" || /^\/[a-z-]+\.html$/.test(url.pathname)) {
      const datei = path.join(__dirname, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      if (fs.existsSync(datei)) return sende(res, 200, fs.readFileSync(datei), "text/html; charset=utf-8");
    }
    if (url.pathname === "/api/suche") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return sende(res, 400, { fehler: "Kein Suchbegriff" });
      return sende(res, 200, await suche(q));
    }
    if (url.pathname === "/api/pruefen") {
      return sende(res, 200, wortschatz.pruefen(url.searchParams.get("q") || ""));
    }
    if (url.pathname === "/api/einstellungen") {
      return sende(res, 200, lies(EINSTELLUNGEN, {}));
    }
    if (url.pathname === "/api/merkliste") {
      // Die Seite kennt nur die Namen, die Datei hält zusätzlich Suchwörter je Eintrag.
      const namen = () => lies(MERKLISTE, []).map((e) => (typeof e === "object" ? e.name : e));
      if (req.method === "POST") {
        const { begriffe } = await body(req);
        if (!Array.isArray(begriffe)) return sende(res, 400, { fehler: "begriffe fehlt" });
        const sauber = [...new Set(begriffe.map((b) => String(b).trim()).filter(Boolean))];
        schreib(MERKLISTE, sauber.map(eintragFuer));
        return sende(res, 200, namen());
      }
      return sende(res, 200, namen());
    }
    sende(res, 404, { fehler: "Nicht gefunden" });
  } catch (e) {
    console.error(e);
    sende(res, 500, { fehler: String(e.message || e) });
  }
}).listen(PORT, () => console.log("Angebote: http://localhost:" + PORT));
