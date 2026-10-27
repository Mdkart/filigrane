// planche.js — planche des pages du fichier affiché : ordre, rotation, pages retirées.

import { tourner } from './moteur.js';
import { $, etat, nbPages, indices, pret, estRV, lotAffiche, tousLesDocs } from './etat.js';
import { vignette } from './lots.js';
import { majInterface, demanderApercu, afficherStatut } from './app.js';

function modifierDoc(docId, changement) {
  for (const d of tousLesDocs()) if (d.id === docId) changement(d);
  majInterface();
  demanderApercu();
}

export function pivoter(quarts) {
  const p = etat.pageChoisie;
  if (!p) return;
  modifierDoc(p.doc, d => { d.rot[p.index] = (((d.rot[p.index] || 0) + quarts) % 4 + 4) % 4; });
}

export function retirerOuRemettre() {
  const p = etat.pageChoisie;
  if (!p) return;
  modifierDoc(p.doc, d => {
    const gardees = indices(d);
    if (gardees.includes(p.index)) {
      if (gardees.length === 1) { afficherStatut('Une page au moins doit rester : retire plutôt le document (✕).', true); return; }
      d.choix = gardees.filter(i => i !== p.index);
    } else {
      // à sa place si l'ordre est celui d'origine, sinon à la fin
      const enOrdre = gardees.every((v, i) => i === 0 || gardees[i - 1] < v);
      const position = enOrdre ? gardees.findIndex(i => i > p.index) : -1;
      gardees.splice(position < 0 ? gardees.length : position, 0, p.index);
      d.choix = gardees.length === nbPages(d) && gardees.every((v, i) => v === i) ? null : gardees;
    }
  });
}

export function deplacerPage(sens) {
  const p = etat.pageChoisie;
  if (!p) return;
  modifierDoc(p.doc, d => {
    const gardees = indices(d);
    const de = gardees.indexOf(p.index), vers = de + sens;
    if (de < 0 || vers < 0 || vers >= gardees.length) return;
    [gardees[de], gardees[vers]] = [gardees[vers], gardees[de]];
    d.choix = gardees;
  });
}

const vignettesPages = new Map();  // « doc|index|quarts » → image (data URL)
const vignettesDemandees = new Set();

export function afficherPlanche() {
  const lot = lotAffiche();
  const planche = $('planche');
  if (!lot || !pret(lot)) { planche.replaceChildren(); return; }
  const elements = [];
  let numero = 0;
  for (const d of lot.docs) {
    if (lot.docs.length > 1) {
      const t = document.createElement('div');
      t.className = 'titre-doc';
      t.textContent = (estRV(lot) ? (d === lot.docs[0] ? 'Recto · ' : 'Verso · ') : '') + d.nom;
      elements.push(t);
    }
    const gardees = estRV(lot) ? indices(d).slice(0, 1) : indices(d);
    const retirees = [...Array(nbPages(d)).keys()].filter(i => !gardees.includes(i));
    for (const i of [...gardees, ...retirees]) {
      const q = d.rot[i] || 0;
      const cle = `${d.id}|${i}|${q}`;
      const garde = gardees.includes(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = garde ? '' : 'retiree';
      const choisie = etat.pageChoisie?.doc === d.id && etat.pageChoisie?.index === i;
      b.setAttribute('aria-pressed', String(choisie));
      const img = document.createElement('img');
      img.alt = '';
      if (vignettesPages.has(cle)) img.src = vignettesPages.get(cle);
      else if (!vignettesDemandees.has(cle)) {
        vignettesDemandees.add(cle);
        vignette(tourner(d.pages[i], q), 150).then(url => { vignettesPages.set(cle, url); if (etat.vue === 'pages') afficherPlanche(); });
      }
      const n = document.createElement('span');
      n.className = 'numero';
      n.textContent = garde ? String(++numero) : ' ';
      b.setAttribute('aria-label', garde ? `Page ${numero}` : 'Page retirée');
      b.append(img, n);
      b.onclick = () => { etat.pageChoisie = { doc: d.id, index: i }; afficherPlanche(); };
      b.ondblclick = () => {
        if (!garde) return;
        const k = positionProduite(lot, d.id, i);
        if (k >= 0) { etat.page = k; choisirVue('apercu'); }
      };
      elements.push(b);
    }
  }
  planche.replaceChildren(...elements);
  majOutilsPages();
}

/** Position d'une page dans le PDF produit (-1 si retirée). */
function positionProduite(lot, docId, index) {
  if (estRV(lot)) return 0;
  let k = 0;
  for (const d of lot.docs) for (const i of indices(d)) { if (d.id === docId && i === index) return k; k++; }
  return -1;
}

function majOutilsPages() {
  const p = etat.pageChoisie;
  const d = p && tousLesDocs().find(x => x.id === p.doc);
  const gardees = d ? indices(d) : [];
  const garde = !!d && gardees.includes(p.index);
  for (const id of ['pivoter-g', 'pivoter-d']) $(id).disabled = !d;
  $('avant').disabled = !garde || gardees.indexOf(p.index) === 0;
  $('apres').disabled = !garde || gardees.indexOf(p.index) === gardees.length - 1;
  $('retirer-page').disabled = !d;
  $('retirer-page').textContent = d && !garde ? 'Remettre la page' : 'Retirer la page';
}

export function choisirVue(vue) {
  etat.vue = vue;
  if (vue === 'pages') etat.comparer = false;
  majInterface();
  demanderApercu();
}
