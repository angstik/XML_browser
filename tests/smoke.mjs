// Test de bout en bout de la PWA construite (dist/) : npm run build && npm test
// Les jeux d'essai sont fabriqués ici ; aucun fichier réel n'est nécessaire.
import { chromium } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startServer } from "./serve.mjs";
import { makeRar } from "./make-rar.mjs";
import { makeZip, makeTar } from "./make-archives.mjs";
import { gzipSync } from "node:zlib";

const rec = (tag, id, date, amount, tva = 0) => `
      <${tag}><PTxID>${id}</PTxID><TotalAmount>${amount.toFixed(2)}</TotalAmount>
        <Charges><TaxList><Tax><Code>1</Code><Name>TVA</Name><Fee>${tva.toFixed(2)}</Fee></Tax></TaxList></Charges>
        <InvoiceID>${id}</InvoiceID><InvoiceDate>${date}</InvoiceDate><Quantity>1</Quantity></${tag}>`;
const block = (account, partner, dispenses, refunds) => `
  <ReconcileTransactions>
    <Header><PartnerID>${partner}</PartnerID><PaymentAccountNumber>${account}</PaymentAccountNumber><FileDate>2026-01-03</FileDate></Header>
    <Detail><DispenseList>${dispenses.join("")}</DispenseList><SuccessfulRefundList>${refunds.join("")}</SuccessfulRefundList></Detail>
    <trailer><TotalDispenseRecords>${dispenses.length}</TotalDispenseRecords><TotalSuccessfulRefundRecords>${refunds.length}</TotalSuccessfulRefundRecords></trailer>
  </ReconcileTransactions>`;
const doc = (...blocks) => `<?xml version="1.0" encoding="UTF-8"?>\n<ReconcilePayLoad>${blocks.join("")}\n</ReconcilePayLoad>\n`;
const D = "Dispense", R = "SuccessfulRefund";

const dir = mkdtempSync(join(tmpdir(), "xmlb-"));
const lot = join(dir, "lot");
mkdirSync(lot);
// a.xml : un client, une date, 3 flux (36,00 TTC dont 6,00 de TVA), 1 refund de 12,00 dont 2,00 de TVA.
writeFileSync(join(lot, "a.xml"), doc(block("AAA", "K1", [rec(D, "a1", "2026-01-01", 12, 2), rec(D, "a2", "2026-01-01", 12, 2), rec(D, "a3", "2026-01-01", 12, 2)], [rec(R, "a4", "2026-01-01", 12, 2)])));
// b.xml : deux clients dans le même fichier.
writeFileSync(join(lot, "b.xml"), doc(block("AAA", "K1", [rec(D, "b1", "2026-01-02", 10)], []), block("BBB", "K2", [rec(D, "b2", "2026-01-02", 20), rec(D, "b3", "2026-01-02", 20)], [])));
writeFileSync(join(lot, "notes.txt"), "pas du xml");
// c.rar : archive contenant un fichier à deux dates pour le client BBB.
const inner = doc(block("BBB", "K2", [rec(D, "c1", "2026-01-02", 5), rec(D, "c2", "2026-01-03", 5)], [rec(R, "c3", "2026-01-03", 5)]));
const innerFile = [{ name: "interne/c.xml", data: new TextEncoder().encode(inner) }];
writeFileSync(join(lot, "c.rar"), makeRar(innerFile));
// Les mêmes données dans les autres formats d'archive, hors du répertoire « lot ».
const archives = ["c.zip", "c_stocke.zip", "c.tar", "c.tar.gz"].map((n) => join(dir, n));
writeFileSync(archives[0], makeZip(innerFile));
writeFileSync(archives[1], makeZip(innerFile, { store: true }));
writeFileSync(archives[2], makeTar(innerFile));
writeFileSync(archives[3], gzipSync(makeTar(innerFile)));

const dist = new URL("../dist/", import.meta.url).pathname;
const { server, url } = await startServer(dist);
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));
const external = [];
page.on("request", (r) => { if (!r.url().startsWith(url) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) external.push(r.url()); });

const cells = (sel) => page.$$eval(sel, (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
const step = (name) => console.log("ok  " + name);

try {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  step("page et service worker");

  // Répertoire : 2 XML, 1 RAR, 1 fichier ignoré.
  await page.setInputFiles("#dirInput", lot);
  await page.waitForSelector("#tbody tr");
  await page.waitForSelector("#progress", { state: "hidden" });
  const rows = await cells("#tbody tr");
  assert.equal(rows.length, 5, "5 lignes attendues : a, b×2 clients, c.rar×2 dates");
  assert.deepEqual(rows[0].slice(0, 4), ["a.xml", "AAA (K1)", "2026-01-01", "2026-01-01"]);
  assert.deepEqual(rows[0].slice(5, 13), ["3", "3", "36,00", "6,00", "30,00", "1", "12,00", "24,00"]);
  assert.equal(rows[0][13], "OK");
  assert.ok(rows[1][0].startsWith("b.xml") && rows[1][0].includes("2 clients"));
  assert.deepEqual([rows[1][1], rows[2][1]], ["AAA (K1)", "BBB (K2)"]);
  assert.ok(rows[3][0].startsWith("c.rar/interne/c.xml") && rows[3][0].includes("2 dates"));
  assert.deepEqual([rows[3][2], rows[3][3], rows[4][2], rows[4][3]], ["2026-01-02", "", "2026-01-03", "2026-01-03"]);
  const total = (await cells("#tfoot tr"))[0];
  assert.deepEqual([total[0], total[1], total[5], total[7]], ["Total : 4 fichiers", "2 clients", "8", "96,00"]);
  assert.deepEqual(await page.$$eval("#ignoredList li", (l) => l.map((x) => x.textContent)), ["notes.txt pas un fichier XML"]);
  step("tableau : répertoire, multi-clients, archive RAR, total");

  // Noms courts.
  await page.check("#shortNames");
  assert.equal((await cells("#tbody tr"))[3][0], "c.xml2 dates");
  assert.equal((await cells("#tbody tr"))[0][0], "a.xml");
  await page.uncheck("#shortNames");
  step("noms courts");

  // Sélection d'un client : synthèse en bandeau.
  const clientValues = await page.$$eval("#selClient option", (o) => o.map((x) => x.value));
  await page.selectOption("#selClient", clientValues[2]);
  assert.equal((await cells("#tbody tr")).length, 3);
  assert.match(await page.textContent("#synth"), /Fichiers2.*Flux4.*TTC50,00/);
  await page.click("#selClear");
  step("sélection par client");

  // Visionneuse sur un fichier extrait de l'archive.
  await page.focus("#tableWrap");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".cm-foldPlaceholder");
  assert.match(await page.textContent("#summary"), /c\.rar\/interne\/c\.xml.*BBB \(K2\).*2026-01-03/);
  assert.match(await page.textContent(".cm-content"), /ReconcilePayLoad/);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#viewer", { state: "hidden" });
  step("visionneuse XML depuis une archive");

  // Synthèse par client et graphes par jour.
  await page.keyboard.press("s");
  await page.waitForSelector("#viz svg");
  const synth = await cells("#sBody tr");
  assert.deepEqual(synth.map((r) => r[0]), ["Tous les clients", "AAA (K1)", "BBB (K2)"]);
  // Tous : 8 flux ; HT = 96 − 6 = 90 ; refunds HT = (12 − 2) + 5 = 15 ; net HT = 75.
  assert.deepEqual([synth[0][1], synth[0][2], synth[0][3], synth[0][4], synth[0][8], synth[0][10]], ["4", "3", "8", "90,00", "15,00", "75,00"]);
  assert.equal(await page.$$eval("#viz svg", (s) => s.length), 2, "deux graphes : nombre et valeur HT");
  assert.equal(await page.$$eval("#viz .viz-chart:first-child .viz-bar", (b) => b.length), 5, "3 jours de dispense + 2 jours de refund");
  await page.keyboard.press("ArrowDown");
  assert.match(await page.textContent("#vizCaption"), /AAA \(K1\).*du 2026-01-01 au 2026-01-02/);
  await page.click("#viz .viz-head button");
  const dayTable = await cells("#viz .viz-table tbody tr");
  assert.deepEqual(dayTable, [["2026-01-01", "3", "30,00", "1", "10,00"], ["2026-01-02", "1", "10,00", "0", "0,00"]]);
  await page.keyboard.press("ArrowDown");          // les flèches changent de client même si le focus est sur un bouton
  assert.match(await page.textContent("#vizCaption"), /BBB \(K2\)/);
  assert.equal(await page.isVisible("#viz .viz-table"), true, "la vue tableau est conservée en changeant de client");
  await page.keyboard.press("ArrowUp");
  await page.focus("#sTableWrap");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#synthScreen", { state: "hidden" });
  assert.equal((await cells("#tbody tr")).length, 2, "retour au tableau filtré sur le client");
  step("synthèse par client, graphes et tableau des jours");

  // Version et mise à jour.
  const version = (await page.textContent("#version")).trim();
  assert.match(version, /^v\d+$/);
  await page.click("#version");
  await page.waitForFunction(() => /dernière version/.test(document.getElementById("toastText").textContent));
  step("version affichée (" + version + ") et vérification de mise à jour");

  // Archives ZIP (compressée et stockée), TAR et TAR.GZ : mêmes lignes que depuis le RAR.
  await page.setInputFiles("#archiveInput", archives);
  await page.waitForSelector("#tbody tr:nth-child(8)");
  await page.waitForSelector("#progress", { state: "hidden" });
  const fromArchives = await cells("#tbody tr");
  assert.equal(fromArchives.length, 8, "4 archives × 2 dates");
  assert.deepEqual(fromArchives.filter((_, i) => i % 2 === 0).map((r) => r[0]).sort(),
    ["c.tar.gz/interne/c.xml2 dates", "c.tar/interne/c.xml2 dates", "c.zip/interne/c.xml2 dates", "c_stocke.zip/interne/c.xml2 dates"].sort());
  for (const r of fromArchives.filter((_, i) => i % 2 === 1)) assert.deepEqual(r.slice(1, 4), ["BBB (K2)", "2026-01-03", "2026-01-03"]);
  assert.deepEqual(await page.$$eval("#ignoredList li", (l) => l.length), 0);
  await page.focus("#tableWrap");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Ligne/.test(document.getElementById("statusPos").textContent));
  assert.match(await page.textContent(".cm-content"), /ReconcilePayLoad/);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#viewer", { state: "hidden" });
  step("archives ZIP, TAR et TAR.GZ");

  // Hors ligne : l'application se recharge depuis le cache et lit toujours les RAR.
  await context.setOffline(true);
  await page.reload();
  await page.setInputFiles("#archiveInput", join(lot, "c.rar"));
  await page.waitForSelector("#tbody tr");
  assert.equal((await cells("#tbody tr")).length, 2);
  await page.click("#version");
  await page.waitForFunction(() => /injoignable/.test(document.getElementById("toastText").textContent));
  await context.setOffline(false);
  step("fonctionnement hors ligne");

  // Hors ligne, l'échec de la requête version.json est attendu et journalisé par le navigateur.
  const real = problems.filter((p) => !/ERR_INTERNET_DISCONNECTED/.test(p));
  assert.deepEqual(real, [], "aucune erreur console ni violation de la politique de sécurité");
  assert.deepEqual(external, [], "aucune requête hors de l'origine de l'application");
  step("aucune erreur, aucune requête externe");
  console.log("\nTous les tests passent.");
} catch (e) {
  console.error("\nÉCHEC : " + (e && e.message ? e.message : e));
  if (problems.length) console.error("Erreurs de la page :\n  " + problems.join("\n  "));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
