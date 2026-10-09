# Journal des modifications

Une entrée par version publiée, la plus récente en premier. Le numéro est celui de
`version.json`, affiché dans l'application. Le build échoue si la version courante n'a pas
son entrée ici.

## v04 (2026-10-09)

- Période : sélection par date minimale et maximale, avec un raccourci « mois complet » qui
  remplit les deux bornes. Elle remplace la sélection d'une date unique.
- La synthèse par client et le graphe suivent la période sélectionnée au tableau.
- Bouton « Copier les noms » : les noms des fichiers affichés (sélections et filtre appliqués)
  sont copiés dans le presse-papiers, séparés par des virgules.
- Graphe par jour unique : les montants HT en barres sur l'axe de gauche, les volumes en
  courbes sur l'axe de droite. Les deux échelles partagent la même grille.
- Noms courts : les 5 derniers caractères du nom, et non plus les 5 premiers.
- Ce journal est ajouté au dépôt.

## v03 (2026-10-08)

- Graphes sur toute la largeur de la page ; l'axe vertical reste fixe pendant le défilement.
- Axe des jours continu : un jour sans donnée garde sa place.
- Trait vertical au 1er de chaque mois, avec le libellé du mois.
- Défilement horizontal commun aux deux graphes.
- Bouton « Exporter en image » : PNG des graphes sur toute leur longueur, sur fond clair.
- Colonne Fichier : un nom trop long est coupé par le début, la fin reste lisible.

## v02 (2026-10-08)

- Lecture des archives ZIP, TAR et TAR.GZ, en plus des RAR. Un fichier `.gz` seul est lu
  comme le fichier qu'il contient.
- Le bouton devient « Ouvrir des archives ».
- Les étiquettes de doublon restent visibles quand le nom de fichier est tronqué.
- Échap ferme la visionneuse même pendant la lecture du fichier.

## v01 (2026-10-08)

- Première version publiée en PWA : installable, utilisable hors ligne.
- Sources : répertoire, archives RAR, glisser-déposer.
- Tableau par fichier, client et date ; sélections par client et par date ; export CSV.
- Synthèse par client et graphes par jour (nombre et valeur HT, dispense et refund).
- Visionneuse XML en lecture seule.
- Version affichée, avec vérification et installation des mises à jour au clic.
- Option de noms de fichier raccourcis à 5 caractères.
- Workflow GitHub Actions : build, test de bout en bout, déploiement sur GitHub Pages.
