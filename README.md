# XML Browser

Application web installable (PWA) pour analyser des fichiers XML de réconciliation
(`ReconcilePayLoad`) : statistiques par fichier, client et date, synthèse par client,
graphes par jour et lecture des fichiers dans une visionneuse XML.

Application en ligne : <https://angstik.github.io/XML_browser/>

## Ce que fait l'application

- **Sources** : un répertoire (avec ou sans sous-répertoires), une ou plusieurs archives
  (RAR, ZIP, TAR, TAR.GZ), ou un glisser-déposer. Une archive trouvée dans un répertoire est
  lue comme un répertoire. Un fichier `.gz` seul est lu comme le fichier qu'il contient.
- **Tableau** : une ligne par fichier, client et date. Colonnes : client
  (`PaymentAccountNumber (PartnerID)`), date dispense, date refund, date fichier, flux, items,
  TTC, TVA, HT, refunds, net, contrôle avec le trailer.
- **Doublons** : un fichier qui donne plusieurs lignes (plusieurs dates ou plusieurs clients)
  est coloré, une couleur par fichier concerné.
- **Sélections** : par client, par période (date minimale et maximale, ou mois complet),
  filtre texte, tri par colonne, noms de fichier raccourcis aux 5 derniers caractères,
  export CSV, copie des noms de fichier affichés dans le presse-papiers.
- **Synthèse par client** : totaux par client sur la période sélectionnée, et un graphe par
  jour : montants HT en barres, volumes en courbes, pour les dispenses et les refunds. L'axe
  des jours est continu, un trait vertical marque chaque 1er du mois, et le graphe s'exporte
  en image PNG. Un tableau donne les mêmes valeurs.
- **Visionneuse XML** en lecture seule : coloration, recherche, repli par élément ou par niveau.

Clavier : `↑` `↓` parcourir, `Entrée` ouvrir, `Échap` revenir, `/` filtrer, `C` client,
`D` période, `S` synthèse.

## Confidentialité

Les fichiers analysés sont lus dans le navigateur et n'en sortent pas. La page est servie avec
une politique de sécurité (`Content-Security-Policy`) qui n'autorise les requêtes que vers sa
propre origine : ses propres fichiers et `version.json`. Une fois installée, l'application
fonctionne hors ligne.

## Version et mise à jour

La version est affichée en haut à droite. Un clic dessus interroge `version.json` sur le
serveur : si une version plus récente est publiée, un bouton « Installer » la télécharge,
l'active et recharge la page.

La version vit dans `version.json`, à la racine du dépôt. Pour publier :

1. modifier le code ;
2. incrémenter `version.json` (par exemple `"02"`) ;
3. décrire la version dans `CHANGELOG.md` (le build l'exige) ;
4. pousser sur `main`.

Le workflow `.github/workflows/deploy.yml` construit `dist/`, lance le test de bout en bout,
puis déploie sur GitHub Pages. Les autres branches sont construites et testées, pas déployées.

Réglage unique du dépôt : *Settings → Pages → Build and deployment → Source : GitHub Actions*.

## Développement

```sh
npm ci
npm run build     # construit dist/
npm test          # test de bout en bout sur dist/ (Chromium via Playwright)
npm run serve     # sert dist/ sur http://localhost:8080/
```

Avant le premier `npm test` : `npx playwright install chromium`.

| Fichier | Rôle |
|---|---|
| `src/app.js` | lecture des sources, analyse, tableau, sélections, synthèse, version |
| `src/viewer.js` | visionneuse XML (CodeMirror 6) |
| `src/charts.js` | graphe par jour en SVG |
| `src/archives.js` | lecture des archives ZIP, TAR et GZIP, sans bibliothèque |
| `src/rar.js` | lecture des archives RAR (node-unrar-js, WebAssembly) |
| `src/sw.js` | service worker : cache hors ligne par version |
| `build.mjs` | assemblage de `dist/` |
| `tests/smoke.mjs` | test de bout en bout, jeux d'essai fabriqués à la volée |

`build.mjs` remplace deux fonctions de node-unrar-js qui fabriquent du code à la volée
(`new Function`), interdit par la politique de sécurité. La version de node-unrar-js est donc
figée dans `package.json` ; le build échoue si le correctif ne s'applique plus.

L'historique des versions est dans [CHANGELOG.md](CHANGELOG.md).

## Dépendances embarquées

- [CodeMirror 6](https://codemirror.net/) (MIT)
- [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) (MIT), qui embarque le code
  UnRAR d'Alexander Roshal : extraction seule, selon la licence UnRAR.
