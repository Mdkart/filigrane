# Filigrane

Ajoute un filigrane anti-usurpation d'identité sur vos pièces justificatives (carte d'identité, avis
d'imposition, fiches de paie…) avant de les envoyer à une agence, une banque, un notaire.

**Tout se passe sur votre appareil** : les documents ne sont envoyés nulle part. Le site ne fait que
fournir la page ; le filigrane est calculé dans votre navigateur. Les règles de sécurité de la page
(Content-Security-Policy) interdisent tout envoi vers un autre site.

- PDF (y compris formulaires remplis), JPG, PNG, photos d'iPhone ;
- texte « Document destiné exclusivement à … – motif – date », trame inclinée, guilloché, micro-texte ;
- recto + verso d'une carte sur une seule page A4, plusieurs documents dans un seul PDF ;
- taille du fichier limitée au besoin (par ex. moins de 2 Mo pour un site qui l'exige) ;
- installable sur l'écran d'accueil de l'iPhone (Partager > Sur l'écran d'accueil), fonctionne hors connexion.

Les PDF sont lus avec [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla), chargé depuis cdnjs au premier PDF.
