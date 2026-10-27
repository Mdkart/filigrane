// worker.js — calcul en arrière-plan : filigrane des pages, encodage JPEG, recherche de la taille cible.
// L'écran reste fluide pendant le rendu (important sur téléphone). Les pages arrivent déjà rendues
// (pdf.js et le décodage des photos restent sur la page) ; rien ne sort de l'appareil.

import { appliquer, melange, jpeg, viser, QUALITE_NORMALE, QUALITE_PLANCHER } from './moteur.js';

function canvasDepuis(bitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  c.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}

self.onmessage = async e => {
  const { id, type } = e.data;
  try {
    if (type === 'apercu') {
      // aperçu filigrané + tailles JPEG pour l'estimation du fichier produit
      const { bitmap, texte, R, graine, page, dpi } = e.data;
      const c = canvasDepuis(bitmap);
      const mesures = appliquer(c, texte, R, melange(graine, page), dpi);
      const tailles = { normale: (await jpeg(c, QUALITE_NORMALE)).size, plancher: (await jpeg(c, QUALITE_PLANCHER)).size };
      const image = c.transferToImageBitmap();
      self.postMessage({ id, image, mesures, tailles }, [image]);
    } else if (type === 'page') {
      // page du fichier produit : filigrane puis JPEG (les pixels ne repassent pas par la page)
      const { bitmap, texte, R, graine, index, dpi, qualite } = e.data;
      const c = canvasDepuis(bitmap);
      appliquer(c, texte, R, melange(graine, index), dpi);
      self.postMessage({ id, blob: await jpeg(c, qualite), pw: c.width, ph: c.height });
    } else if (type === 'viser') {
      const { rendues, dpi, cible } = e.data;
      const r = await viser(rendues, dpi, cible, f => self.postMessage({ id, progression: f }), () => false);
      self.postMessage({ id, resultat: r });
    }
  } catch (err) {
    self.postMessage({ id, erreur: err?.message || String(err) });
  }
};
