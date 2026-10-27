// etat.js — état partagé de la page (documents, réglages, historique) et fonctions de base sur les
// fichiers à produire. Réglages et historique restent dans ce navigateur (localStorage).

import { reglagesParDefaut, rectoVerso, tourner } from './moteur.js';

export const $ = id => document.getElementById(id);

// styles tout prêts (mêmes valeurs que l'app Mac) : intensité, densité, taille du texte
export const FORCES = { discret: [0.25, 0.85, 0.9], standard: [0.35, 1.0, 1.0], marque: [0.55, 1.3, 1.1] };

// MARK: Mémoire du navigateur — localStorage, sans jamais bloquer (navigation privée)

export function lire(cle, defaut) {
  try { return { ...defaut, ...JSON.parse(localStorage.getItem(cle) || '{}') }; } catch { return { ...defaut }; }
}
export function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* tant pis */ }
}

export const etat = {
  R: lire('filigrane.reglages', reglagesParDefaut),
  historique: lire('filigrane.historique', { destinataires: [], motifs: [], associations: {} }),
  lots: [],            // { id, docs: [doc], rectoVerso, nom }
  lotAffiche: null,
  page: 0,
  vue: 'apercu',       // ou 'pages' (planche)
  comparer: false,
  coupe: 0.5,          // avant / après : position de la ligne
  modeSelection: false,
  selection: new Set(),  // documents cochés
  pageChoisie: null,     // planche : { doc, index }
  suggestion: null,      // deux photos ajoutées ensemble : [id, id]
  graine: (Math.random() * 4294967296) >>> 0,
  traitement: false,
  arret: false,
  resultats: [],
  motifAuto: null,
  estimation: null,      // { tailles, dpi, nb } d'après le dernier aperçu
  dateAutre: false,      // « Autre date… » choisi
  cibleAutre: false,     // « Autre taille… » choisi
  voirExemple: false,    // sans document : aperçu d'exemple au lieu de l'accueil
};
export const TAILLES = [500, 1024, 2048, 5120, 10240];  // Ko
let prochainId = 1;
export const nouvelId = () => prochainId++;

// MARK: Documents et fichiers à produire

// doc : { id, fichier, nom, pages, erreur, vignette, choix (indices gardés, dans l'ordre ; null = toutes), rot }
export const nbPages = d => d.pages?.length ?? 0;
export const indices = d => (d.choix ?? [...Array(nbPages(d)).keys()]).filter(i => i < nbPages(d));
export const sources = d => indices(d).map(i => tourner(d.pages[i], d.rot[i] || 0));
export const pret = lot => lot.docs.length > 0 && lot.docs.every(d => d.pages && !d.erreur);
export const estRV = lot => !!lot && lot.rectoVerso && lot.docs.length === 2;
export const pagesLot = lot => (estRV(lot) ? [rectoVerso(sources(lot.docs[0])[0], sources(lot.docs[1])[0])] : lot.docs.flatMap(sources));
export const nbPagesLot = lot => (estRV(lot) ? 1 : lot.docs.reduce((n, d) => n + indices(d).length, 0));
export const cleLot = lot => `${estRV(lot) ? 'rv' : 'suite'}#${lot.docs.map(d => `${d.id}:${indices(d)}:${JSON.stringify(d.rot)}`).join('#')}`;
export const lotAffiche = () => etat.lots.find(l => l.id === etat.lotAffiche) ?? etat.lots[0];
export const lotDe = docId => etat.lots.find(l => l.docs.some(d => d.id === docId));
export const tousLesDocs = () => etat.lots.flatMap(l => l.docs);

/** Texte utilisable dans un nom de fichier (sans « / » ni « : », 60 caractères au plus). */
export function nettoyer(t) {
  return t.trim().replace(/[/:\\]/g, '-').slice(0, 60).replace(/^[. ]+|[. ]+$/g, '');
}

/** Nom du PDF produit : « cni_filigrane_Agence Immo Lille.pdf » (le destinataire évite d'écraser un envoi). */
export function nomFichier(lot) {
  if (lot.nom?.trim()) return `${nettoyer(lot.nom)}.pdf`;
  let base = (lot.docs[0]?.nom ?? 'document').replace(/\.[^.]+$/, '');
  if (estRV(lot)) base = base.replace(/[ _-]recto$/i, '');
  const genre = estRV(lot) ? '_recto_verso' : lot.docs.length > 1 ? '_dossier' : '';
  const d = nettoyer($('destinataire').value);
  return `${base}${genre}_filigrane${d ? '_' + d : ''}.pdf`;
}

export function titreLot(lot) {
  if (lot.nom?.trim()) return lot.nom.trim();
  if (estRV(lot)) return 'Recto + verso sur une page';
  const n = nbPagesLot(lot);
  return `Un seul PDF · ${lot.docs.length} documents, ${n} page${n > 1 ? 's' : ''}`;
}
