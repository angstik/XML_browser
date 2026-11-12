# Journal des modifications

Une entrée par version publiée, la plus récente en premier. Le numéro est celui de
`version.json`, affiché dans l'application. Le build échoue si la version courante n'a pas
son entrée ici.

## v09 (2026-11-12)

- Écran principal : coches « Doublons » (fichiers au contenu identique à un autre) et « Flux
  dupliqués » (fichiers dont des InvoiceID se retrouvent dans un autre fichier ou sont répétés
  dans le fichier). Cochées ensemble, l'une ou l'autre condition suffit.
- Export des fichiers : la règle « doublons » (fichiers identiques, flux déjà présents dans un
  fichier exporté avant) est séparée de la règle « flux répétés dans un même fichier » ; le
  rapport les compte dans deux colonnes.
- Les octets lus au chargement sont gardés en mémoire (jusqu'à 512 Mo) : l'export et la
  visionneuse ne relisent plus le disque. Un fichier devenu illisible sur le disque est signalé
  clairement (« fichier modifié, déplacé ou supprimé depuis le chargement »).
- Téléchargements (CSV, ZIP, image) : l'adresse du contenu reste valable 10 minutes, pour les
  navigateurs qui demandent où enregistrer. L'export CSV confirme le nombre de lignes et
  affiche un message en cas d'erreur.

## v08 (2026-11-12)

- Analyse : les noms de fichier sont des liens vers le détail du fichier, les noms de client
  des liens vers l'analyse client, ce client présélectionné ; Échap ramène à l'analyse.
- Analyse : dans les tableaux de doublons, les fichiers sont listés l'un sous l'autre.
- « Synthèse par client » devient « Analyse client ». Les boutons Analyse client et Analyse
  sont colorés.
- Analyse client : écran figé, le tableau défile seul avec sa ligne de titres, le graphe reste
  en bas ; le mode d'emploi passe dans le bandeau du haut.
- Analyse client : le graphe porte l'enveloppe prévisionnelle du client (ou de l'agrégat),
  mise à 0 hors du mois principal, avec les jours hors enveloppe ; mesure prévue au choix.

## v07 (2026-11-10)

- Analyse : les doublons (fichiers identiques, flux communs, flux répétés) sont signalés en
  rouge. Les refunds de même InvoiceID présents dans plusieurs fichiers sont aussi comptés. Les jours manquants du 1er au dernier jour du mois principal sont listés à part, en
  rouge, tous clients et par client, avec une ligne rouge dans le résumé.
- Bouton « Exporter les fichiers » (touche E) : les fichiers retenus sont écrits au format XML
  d'origine, en ZIP ou dans un répertoire, selon des règles à cocher : sélection affichée,
  mois principal, suppression des doublons, dispenses ou refunds seulement, exclusion des
  fichiers en écart de trailer, des fichiers devenus vides. Le trailer des fichiers modifiés est
  recalculé ; un rapport CSV détaille ce qui a été gardé et retiré.

## v06 (2026-11-10)

- Nouvel écran « Analyse » (bouton ou touche A), sur la période sélectionnée, tous clients :
  - mois principal (celui qui compte le plus de flux) et volume hors de ce mois (nombre,
    valeur HT, refunds), global et par client ;
  - couverture des jours : jours sans aucun enregistrement entre le premier et le dernier jour,
    regroupés en plages, global et par client (entre son premier et son dernier jour) ;
  - doublons : fichiers au contenu identique, flux (InvoiceID) présents dans plusieurs fichiers,
    flux répétés dans un même fichier, avec les jours et les clients concernés ;
  - graphe par jour avec enveloppe prévisionnelle verte : tendance par client (Theil-Sen)
    corrigée du jour de la semaine, agrégée sur les clients, prolongée de 7 jours ; jours hors
    enveloppe sur fond rouge et liste des zones douteuses.
- Les fichiers identiques ne sont comptés qu'une fois dans l'analyse.

## v05 (2026-11-10)

- Colonne « Émission » triable : date et heure d'émission du fichier (Header / FileDate et
  FileTime), au format court AAMMJJ_HHMMSS. Elle remplace la colonne « Date fichier ».
- Colonne « Empreinte » triable : début (10 caractères) de l'empreinte SHA-256 du contenu du
  fichier. Un fichier au contenu identique à un autre fichier chargé est en rouge, avec la liste
  des fichiers identiques au survol ; le total compte les doublons.
- Colonnes Flux, TVA et HT retirées du tableau pour tenir dans la largeur de l'écran ; elles
  restent dans l'export CSV, qui donne aussi l'empreinte complète.
- Visionneuse : la date et l'heure d'émission, et l'empreinte, figurent dans l'en-tête.
- Intégration continue : le workflow tourne sur Ubuntu 24.04. `ubuntu-latest` est passé à
  Ubuntu 26.04, où le navigateur de test (Playwright 1.56) ne s'installe pas.

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
