// lots.js — fichiers à produire : ajout des documents, réunir / séparer / recto + verso, liste affichée.

import { ouvrir, rendrePage, liberer, estPDF } from './moteur.js';
import {
  $, etat, nouvelId, nbPages, indices, estRV, lotAffiche, lotDe, tousLesDocs, nomFichier, titreLot,
} from './etat.js';
import { majInterface, demanderApercu, afficherStatut, fermerResultats } from './app.js';

export async function ajouter(fichiers) {
  const acceptes = [...fichiers].filter(f => estPDF(f) || f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png)$/i.test(f.name));
  if (!acceptes.length) {
    if (fichiers.length) afficherStatut('Formats acceptés : PDF, JPG, PNG, HEIC.', true);
    return;
  }
  fermerResultats();
  const nouveaux = acceptes.map(f => ({ id: nouvelId(), fichier: f, nom: f.name, pages: null, erreur: null, vignette: null, choix: null, rot: {} }));
  for (const d of nouveaux) etat.lots.push({ id: nouvelId(), docs: [d], rectoVerso: false, nom: null });
  etat.lotAffiche = lotDe(nouveaux[0].id).id;
  etat.page = 0;
  etat.suggestion = nouveaux.length === 2 && nouveaux.every(d => !estPDF(d.fichier)) ? nouveaux.map(d => d.id) : null;
  majInterface();
  await Promise.all(nouveaux.map(async d => {
    try {
      d.pages = await ouvrir(d.fichier);
      d.vignette = await vignette(d.pages[0]);
    } catch (e) {
      d.erreur = e.message || String(e);
    }
    majInterface();
  }));
  demanderApercu();
}

export async function vignette(page, cote = 88) {
  const c = await rendrePage(page, 72 * cote / Math.max(page.w, page.h));
  const url = c.toDataURL('image/jpeg', 0.75);
  liberer(c);
  return url;
}

/** Modifie les lots d'un coup : pas de lot vide, recto + verso seulement à deux documents. */
export function modifierLots(changement) {
  changement(etat.lots);
  etat.lots = etat.lots.filter(l => l.docs.length);
  for (const l of etat.lots) if (l.docs.length !== 2) l.rectoVerso = false;
  if (!etat.lots.some(l => l.id === etat.lotAffiche)) etat.lotAffiche = etat.lots[0]?.id ?? null;
  const ids = new Set(tousLesDocs().map(d => d.id));
  for (const id of [...etat.selection]) if (!ids.has(id)) etat.selection.delete(id);
  if (etat.suggestion && !etat.suggestion.every(id => ids.has(id))) etat.suggestion = null;
  if (etat.pageChoisie && !ids.has(etat.pageChoisie.doc)) etat.pageChoisie = null;
  majInterface();
  demanderApercu();
}

export const docsCoches = () => tousLesDocs().filter(d => etat.selection.has(d.id));

/** Réunit les documents cochés en un seul PDF (ou en recto + verso), à la place du premier. */
export function reunir(rv = false) {
  const docs = docsCoches();
  if (docs.length < 2) return;
  const ids = new Set(docs.map(d => d.id));
  const nouveau = { id: nouvelId(), docs, rectoVerso: rv && docs.length === 2, nom: null };
  etat.lotAffiche = nouveau.id;
  etat.suggestion = null;
  etat.modeSelection = false;
  etat.selection.clear();
  modifierLots(lots => {
    const position = lots.findIndex(l => l.docs.some(d => ids.has(d.id)));
    for (const l of lots) l.docs = l.docs.filter(d => !ids.has(d.id));
    lots.splice(position < 0 ? lots.length : position, 0, nouveau);
  });
}

export function separer() {
  const ids = new Set(docsCoches().map(d => d.id));
  etat.modeSelection = false;
  etat.selection.clear();
  modifierLots(lots => {
    const nouveaux = lots.flatMap(l => (l.docs.length > 1 && l.docs.some(d => ids.has(d.id))
      ? l.docs.map(d => ({ id: nouvelId(), docs: [d], rectoVerso: false, nom: null })) : [l]));
    lots.splice(0, lots.length, ...nouveaux);
  });
}

export function retirerDocs(ids) {
  modifierLots(lots => { for (const l of lots) l.docs = l.docs.filter(d => !ids.has(d.id)); });
}

export function quitterSelection() {
  etat.modeSelection = false;
  etat.selection.clear();
  majInterface();
}

/** Les deux documents cochés forment déjà un recto + verso : le bouton les remet à la suite. */
export function rvCoche() {
  const docs = docsCoches();
  const lot = docs.length === 2 && lotDe(docs[0].id);
  return lot && estRV(lot) && lot.docs.every(d => etat.selection.has(d.id)) ? lot : null;
}

export function afficherLots() {
  const ul = $('lots');
  ul.classList.toggle('selection', etat.modeSelection);
  const elements = [];
  const plusieurs = etat.lots.length > 1;
  for (const lot of etat.lots) {
    if (lot.docs.length > 1) {
      const li = document.createElement('li');
      li.className = 'lot-titre';
      const icone = document.createElement('span');
      icone.className = 'icone-lot';
      icone.setAttribute('aria-hidden', 'true');
      icone.textContent = estRV(lot) ? '⊟' : '⧉';
      const infos = document.createElement('div');
      infos.className = 'infos';
      const nom = document.createElement('div');
      nom.className = 'nom';
      nom.textContent = titreLot(lot);
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = nomFichier(lot);
      // actions sous le titre : sur un téléphone, à droite elles écraseraient le titre
      const liens = document.createElement('div');
      liens.className = 'liens';
      infos.append(nom, detail, liens);
      li.append(icone, infos);
      if (estRV(lot)) liens.append(lien('Inverser', () => modifierLots(() => lot.docs.reverse())));
      liens.append(lien('Renommer', () => {
        const n = prompt('Nom du fichier produit (sans .pdf ; vide : nom automatique)', lot.nom ?? nomFichier(lot).replace(/\.pdf$/, ''));
        if (n === null) return;
        lot.nom = n.trim() && `${n.trim()}.pdf` !== nomFichier({ ...lot, nom: null }) ? n.trim() : null;
        modifierLots(() => {});
      }));
      elements.push(li);
    }
    for (const [i, d] of lot.docs.entries()) elements.push(ligneDocument(lot, d, i, plusieurs));
  }
  ul.replaceChildren(...elements);

  // sélection
  const nbDocs = tousLesDocs().length;
  if (nbDocs < 2 && etat.modeSelection) etat.modeSelection = false;
  $('selectionner').hidden = nbDocs < 2;
  $('selectionner').textContent = etat.modeSelection ? 'OK' : 'Sélectionner';
  $('actions-selection').hidden = !etat.modeSelection;
  const coches = docsCoches();
  $('reunir').disabled = coches.length < 2;
  $('recto-verso').disabled = coches.length !== 2;
  $('recto-verso').textContent = rvCoche() ? 'Pages à la suite' : 'Recto + verso';
  $('separer').disabled = !coches.some(d => lotDe(d.id).docs.length > 1);
  $('retirer').disabled = !coches.length;
  $('suggestion').hidden = !etat.suggestion || etat.modeSelection;
  $('note-docs').textContent = !nbDocs ? 'PDF, photos (JPG, PNG, HEIC). Tu peux aussi glisser des fichiers ici.'
    : etat.modeSelection ? 'Coche des documents, puis choisis une action.'
    : plusieurs && !etat.lots.some(l => l.docs.length > 1) ? 'Un PDF par document. Pour en réunir : Sélectionner, puis Réunir.'
    : plusieurs ? 'Touche un document pour le voir dans l’aperçu.' : '';
  $('note-docs').hidden = !$('note-docs').textContent;
}

export function lien(texte, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lien';
  b.textContent = texte;
  b.onclick = action;
  return b;
}

function ligneDocument(lot, d, rang, plusieurs) {
  const li = document.createElement('li');
  const affiche = lotAffiche()?.id === lot.id;
  li.className = 'doc' + (lot.docs.length > 1 ? ' dans-groupe' : '') + (affiche && plusieurs && !etat.modeSelection ? ' choisi' : '')
    + (etat.selection.has(d.id) ? ' coche' : '');
  const caseCoche = document.createElement('span');
  caseCoche.className = 'case';
  caseCoche.setAttribute('aria-hidden', 'true');
  caseCoche.textContent = etat.selection.has(d.id) ? '✓' : '';
  const img = document.createElement(d.vignette ? 'img' : 'div');
  img.className = 'vignette';
  if (d.vignette) { img.src = d.vignette; img.alt = ''; }
  const infos = document.createElement('div');
  infos.className = 'infos';
  infos.tabIndex = 0;
  infos.setAttribute('role', etat.modeSelection ? 'checkbox' : 'button');
  if (etat.modeSelection) infos.setAttribute('aria-checked', String(etat.selection.has(d.id)));
  infos.setAttribute('aria-label', etat.modeSelection ? `Cocher ${d.nom}` : `Afficher ${d.nom} dans l’aperçu`);
  const nom = document.createElement('div');
  nom.className = 'nom';
  nom.textContent = d.nom;
  const detail = document.createElement('div');
  detail.className = 'detail' + (d.erreur ? ' erreur' : '');
  if (d.erreur) detail.textContent = d.erreur;
  else if (!d.pages) detail.textContent = 'Ouverture…';
  else if (estRV(lot)) detail.textContent = rang === 0 ? 'Recto' : 'Verso';
  else {
    const g = indices(d).length, n = nbPages(d);
    detail.textContent = (g === n ? `${n} page${n > 1 ? 's' : ''}` : `${g} page${g > 1 ? 's' : ''} sur ${n}`)
      + (Object.values(d.rot).some(q => q % 4) ? ' · pivotée' : '');
  }
  infos.append(nom, detail);
  const agir = () => {
    if (etat.modeSelection) {
      if (etat.selection.has(d.id)) etat.selection.delete(d.id); else etat.selection.add(d.id);
      afficherLots();
    } else {
      etat.lotAffiche = lot.id;
      etat.page = 0;
      etat.pageChoisie = null;
      majInterface();
      demanderApercu();
    }
  };
  infos.onclick = agir;
  caseCoche.onclick = agir;
  infos.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); agir(); } };
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'retirer';
  bouton.textContent = '✕';
  bouton.setAttribute('aria-label', `Retirer ${d.nom}`);
  bouton.onclick = () => retirerDocs(new Set([d.id]));
  li.append(caseCoche, img, infos, bouton);
  return li;
}
