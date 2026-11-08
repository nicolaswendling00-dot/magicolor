# MagicColor

PWA de coloriage magique : on importe un coloriage (PNG, JPG, WebP), on associe chaque symbole à sa couleur, puis on colorie du bout du doigt. Aucune dépendance, aucun build.

En ligne : https://nicolaswendling00-dot.github.io/magicolor/

## Lancer

```bash
node serve.mjs 5210
```

Puis ouvrir http://localhost:5210. Sur `localhost` le service worker est désactivé pour toujours servir les fichiers frais ; sur `127.0.0.1` ou en ligne il est actif (hors ligne après le premier chargement).

Publié sur GitHub Pages depuis `main` : `serve.mjs`, `tools/` et `tests/` restent en local (`.gitignore`). Changer `CACHE_NAME` dans `sw.js` à chaque version.

## Organisation

| Fichier | Rôle |
|---|---|
| `js/analyze.js` | Analyse de l'image : traits, zones, symboles (calcul pur) |
| `js/worker.js` | Lance l'analyse hors du fil principal |
| `js/glyphs.js` | Lecture des symboles par comparaison avec des caractères dessinés |
| `js/model.js` | Symbole de chaque zone |
| `js/sheet.js` | Canvas, peinture des zones, zoom, déplacement, toucher |
| `js/db.js` | Sauvegarde IndexedDB |
| `js/app.js` | Écrans : bibliothèque, préparation, coloriage |
| `tools/icones.mjs` | Génère les icônes PNG |
| `tests/analyse.html` | Mesure l'analyse sur l'exemple et sur un coloriage synthétique |

## Comment marche le remplissage

L'image est analysée une fois : seuil d'Otsu combiné à une moyenne locale (tient sur une photo mal éclairée), puis étiquetage de toutes les zones fermées (4-connexité, une diagonale ne fuit pas). Les petits traits isolés dans une seule zone sont reconnus comme symboles et appartiennent à cette zone : quand on la colorie, son chiffre disparaît. Près des traits, la couleur garde l'anticrénelage. Un toucher se résume ensuite à lire le numéro de zone sous le doigt.

Si l'algorithme change les numéros de zones, incrémenter `VERSION` dans `analyze.js` : les coloriages enregistrés repartent de zéro au lieu de colorier les mauvaises zones.

## Limites connues

- La lecture des symboles se trompe sur les très petits caractères (moins de 7 px) : l'écran de préparation permet de corriger chaque forme, et le mode libre colorie avec la couleur choisie quoi qu'il arrive.
- Un chiffre qui touche un trait n'est pas reconnu : sa zone reste coloriable librement mais ne compte pas dans la progression.
- Un contour ouvert fait communiquer deux zones : l'option « Fermer les petites ouvertures » épaissit les traits d'un pixel, et l'annulation reste possible.
