// app.js — interface de la version web de Filigrane (même logique que l'app Mac 3.4).
// Fichiers à produire (un PDF par lot), pages (ordre, rotation, pages retirées), avant / après, estimation de
// la taille. Réglages et historique restent dans ce navigateur (localStorage).

import {
  A4, reglagesParDefaut, phrase, ouvrir, rectoVerso, tourner, rendrePage, alerte, liberer, estPDF,
  SURCOUT_PAGE, SURCOUT_FIXE, EXPOSANT,
} from './moteur.js';
import { apercu as filigranerApercu, produire } from './calcul.js';

const $ = id => document.getElementById(id);
const motifsPredefinis = ['Dossier de location', 'Ouverture de compte bancaire', 'Dossier de prêt',
  'Notaire', 'Assurance', 'Employeur', 'Administration'];

// styles tout prêts (mêmes valeurs que l'app Mac) : intensité, densité, taille du texte
const FORCES = { discret: [0.25, 0.85, 0.9], standard: [0.35, 1.0, 1.0], marque: [0.55, 1.3, 1.1] };

// MARK: Mémoire du navigateur — localStorage, sans jamais bloquer (navigation privée)

function lire(cle, defaut) {
  try { return { ...defaut, ...JSON.parse(localStorage.getItem(cle) || '{}') }; } catch { return { ...defaut }; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* tant pis */ }
}

const etat = {
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
};
let prochainId = 1;

// MARK: Documents et fichiers à produire

// doc : { id, fichier, nom, pages, erreur, vignette, choix (indices gardés, dans l'ordre ; null = toutes), rot }
const nbPages = d => d.pages?.length ?? 0;
const indices = d => (d.choix ?? [...Array(nbPages(d)).keys()]).filter(i => i < nbPages(d));
const sources = d => indices(d).map(i => tourner(d.pages[i], d.rot[i] || 0));
const pret = lot => lot.docs.length > 0 && lot.docs.every(d => d.pages && !d.erreur);
const estRV = lot => !!lot && lot.rectoVerso && lot.docs.length === 2;
const pagesLot = lot => (estRV(lot) ? [rectoVerso(sources(lot.docs[0])[0], sources(lot.docs[1])[0])] : lot.docs.flatMap(sources));
const nbPagesLot = lot => (estRV(lot) ? 1 : lot.docs.reduce((n, d) => n + indices(d).length, 0));
const cleLot = lot => `${estRV(lot) ? 'rv' : 'suite'}#${lot.docs.map(d => `${d.id}:${indices(d)}:${JSON.stringify(d.rot)}`).join('#')}`;
const lotAffiche = () => etat.lots.find(l => l.id === etat.lotAffiche) ?? etat.lots[0];
const lotDe = docId => etat.lots.find(l => l.docs.some(d => d.id === docId));
const tousLesDocs = () => etat.lots.flatMap(l => l.docs);

/** Texte utilisable dans un nom de fichier (sans « / » ni « : », 60 caractères au plus). */
function nettoyer(t) {
  return t.trim().replace(/[/:\\]/g, '-').slice(0, 60).replace(/^[. ]+|[. ]+$/g, '');
}

/** Nom du PDF produit : « cni_filigrane_Agence Immo Lille.pdf » (le destinataire évite d'écraser un envoi). */
function nomFichier(lot) {
  if (lot.nom?.trim()) return `${nettoyer(lot.nom)}.pdf`;
  let base = (lot.docs[0]?.nom ?? 'document').replace(/\.[^.]+$/, '');
  if (estRV(lot)) base = base.replace(/[ _-]recto$/i, '');
  const genre = estRV(lot) ? '_recto_verso' : lot.docs.length > 1 ? '_dossier' : '';
  const d = nettoyer($('destinataire').value);
  return `${base}${genre}_filigrane${d ? '_' + d : ''}.pdf`;
}

function titreLot(lot) {
  if (lot.nom?.trim()) return lot.nom.trim();
  if (estRV(lot)) return 'Recto + verso sur une page';
  const n = nbPagesLot(lot);
  return `Un seul PDF · ${lot.docs.length} documents, ${n} page${n > 1 ? 's' : ''}`;
}

async function ajouter(fichiers) {
  const acceptes = [...fichiers].filter(f => estPDF(f) || f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png)$/i.test(f.name));
  if (!acceptes.length) {
    if (fichiers.length) afficherStatut('Formats acceptés : PDF, JPG, PNG, HEIC.', true);
    return;
  }
  fermerResultats();
  const nouveaux = acceptes.map(f => ({ id: prochainId++, fichier: f, nom: f.name, pages: null, erreur: null, vignette: null, choix: null, rot: {} }));
  for (const d of nouveaux) etat.lots.push({ id: prochainId++, docs: [d], rectoVerso: false, nom: null });
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

async function vignette(page, cote = 88) {
  const c = await rendrePage(page, 72 * cote / Math.max(page.w, page.h));
  const url = c.toDataURL('image/jpeg', 0.75);
  liberer(c);
  return url;
}

/** Modifie les lots d'un coup : pas de lot vide, recto + verso seulement à deux documents. */
function modifierLots(changement) {
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

const docsCoches = () => tousLesDocs().filter(d => etat.selection.has(d.id));

/** Réunit les documents cochés en un seul PDF (ou en recto + verso), à la place du premier. */
function reunir(rv = false) {
  const docs = docsCoches();
  if (docs.length < 2) return;
  const ids = new Set(docs.map(d => d.id));
  const nouveau = { id: prochainId++, docs, rectoVerso: rv && docs.length === 2, nom: null };
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

function separer() {
  const ids = new Set(docsCoches().map(d => d.id));
  etat.modeSelection = false;
  etat.selection.clear();
  modifierLots(lots => {
    const nouveaux = lots.flatMap(l => (l.docs.length > 1 && l.docs.some(d => ids.has(d.id))
      ? l.docs.map(d => ({ id: prochainId++, docs: [d], rectoVerso: false, nom: null })) : [l]));
    lots.splice(0, lots.length, ...nouveaux);
  });
}

function retirerDocs(ids) {
  modifierLots(lots => { for (const l of lots) l.docs = l.docs.filter(d => !ids.has(d.id)); });
}

function quitterSelection() {
  etat.modeSelection = false;
  etat.selection.clear();
  majInterface();
}

/** Les deux documents cochés forment déjà un recto + verso : le bouton les remet à la suite. */
function rvCoche() {
  const docs = docsCoches();
  const lot = docs.length === 2 && lotDe(docs[0].id);
  return lot && estRV(lot) && lot.docs.every(d => etat.selection.has(d.id)) ? lot : null;
}

// MARK: Pages (planche)

function modifierDoc(docId, changement) {
  for (const d of tousLesDocs()) if (d.id === docId) changement(d);
  majInterface();
  demanderApercu();
}

function pivoter(quarts) {
  const p = etat.pageChoisie;
  if (!p) return;
  modifierDoc(p.doc, d => { d.rot[p.index] = (((d.rot[p.index] || 0) + quarts) % 4 + 4) % 4; });
}

function retirerOuRemettre() {
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

function deplacerPage(sens) {
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

function afficherPlanche() {
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

function choisirVue(vue) {
  etat.vue = vue;
  if (vue === 'pages') etat.comparer = false;
  majInterface();
  demanderApercu();
}

// MARK: Texte, historique

const texteFiligrane = () => phrase($('destinataire').value, $('motif').value, etat.R.date ? dateChoisie() : null);

function dateChoisie() {
  const v = $('date').value;
  if (!v) return new Date();
  const [a, m, j] = v.split('-').map(Number);
  return new Date(a, m - 1, j);
}

function listesHistorique() {
  const h = etat.historique;
  $('liste-dest').replaceChildren(...h.destinataires.map(d => new Option(d)));
  const motifs = [...h.motifs, ...motifsPredefinis.filter(m => !h.motifs.includes(m))];
  $('liste-motifs').replaceChildren(...motifs.map(m => new Option(m)));
}

function memoriser(destinataire, motif) {
  const h = etat.historique;
  const recents = (liste, v) => [v, ...liste.filter(x => x !== v)].slice(0, 12);
  if (destinataire) {
    h.destinataires = recents(h.destinataires, destinataire);
    h.associations[destinataire] = { motif, taille: etat.R.taille, cible_ko: etat.R.cible_ko };
    for (const d of Object.keys(h.associations)) if (!h.destinataires.includes(d)) delete h.associations[d];
  }
  if (motif) h.motifs = recents(h.motifs, motif);
  ecrire('filigrane.historique', h);
  listesHistorique();
}

// destinataire connu : reprend son dernier motif (si vide ou rempli automatiquement) et sa taille
function appliquerAssociation() {
  const a = etat.historique.associations[$('destinataire').value.trim()];
  if (!a) return;
  const motif = $('motif');
  if (!motif.value || motif.value === etat.motifAuto) {
    motif.value = a.motif || '';
    etat.motifAuto = motif.value;
  }
  if (a.taille) etat.R.taille = a.taille;
  if (a.cible_ko) etat.R.cible_ko = a.cible_ko;
  enregistrerReglages();
}

function choisirDestinataire(d) {
  $('destinataire').value = d;
  appliquerAssociation();
  majInterface();
  demanderApercu();
}

// MARK: Réglages

const curseurs = {
  opacite: v => `${Math.round(v * 100)} %`,
  echelle: v => `${Math.round(v * 100)} %`,
  densite: v => (v < 0.85 ? 'Aérée' : v > 1.25 ? 'Dense' : 'Normale'),
  angle: v => `${Math.round(v)}°`,
};

function forceActuelle() {
  const R = etat.R;
  return Object.keys(FORCES).find(f => {
    const [o, d, e] = FORCES[f];
    return Math.abs(R.opacite - o) < 0.005 && Math.abs(R.densite - d) < 0.005 && Math.abs(R.echelle - e) < 0.005;
  }) ?? null;
}

function enregistrerReglages() {
  ecrire('filigrane.reglages', etat.R);
  majInterface();
}

// MARK: Affichage

function majInterface() {
  const R = etat.R;
  // réglages
  for (const [cle, format] of Object.entries(curseurs)) {
    const el = $(cle);
    if (document.activeElement !== el) el.value = R[cle];
    el.nextElementSibling.value = format(Number(R[cle]));
    el.setAttribute('aria-valuetext', format(Number(R[cle])));
  }
  const force = forceActuelle();
  for (const r of document.getElementsByName('force')) r.checked = r.value === force;
  $('perso').hidden = !!force;
  const predefinies = [...document.querySelectorAll('#couleurs button')];
  for (const b of predefinies) b.setAttribute('aria-checked', String(b.dataset.couleur === R.couleur));
  const autre = !predefinies.some(b => b.dataset.couleur === R.couleur);
  const pastille = document.querySelector('.pastille-autre');
  pastille.classList.toggle('choisie', autre);
  if (autre) pastille.style.setProperty('background', R.couleur); else pastille.style.removeProperty('background');
  $('couleur-autre').value = R.couleur;
  for (const r of document.getElementsByName('style')) r.checked = r.value === R.style;
  $('diagonales').checked = R.diagonales === 2;
  $('guilloche').checked = R.guilloche;
  $('micro_texte').checked = R.micro_texte;
  $('avec-date').checked = R.date;
  $('date').disabled = !R.date;
  for (const r of document.getElementsByName('taille')) r.checked = r.value === (R.taille === 'limitee' ? 'limitee' : 'normale');
  $('carte-cible').hidden = R.taille !== 'limitee';
  $('cible').value = String(R.cible_ko);
  majTaille();

  // destinataires récents en pastilles
  const recents = etat.historique.destinataires.slice(0, 6);
  $('recents').hidden = !recents.length;
  const actuel = $('destinataire').value.trim();
  $('recents').replaceChildren(...recents.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d;
    b.setAttribute('aria-pressed', String(d === actuel));
    b.onclick = () => choisirDestinataire(d);
    return b;
  }));

  afficherLots();

  // aperçu / pages
  const avecDocs = etat.lots.some(pret);
  if (!avecDocs && etat.vue === 'pages') etat.vue = 'apercu';
  $('vue').hidden = !avecDocs;
  for (const r of document.getElementsByName('vue')) r.checked = r.value === etat.vue;
  const pages = etat.vue === 'pages';
  $('apercu').hidden = pages;
  $('planche').hidden = !pages;
  $('outils-pages').hidden = !pages;
  $('comparer').hidden = pages;
  $('tirage').hidden = pages;
  $('pages').hidden = pages || $('pages').hidden;
  if (pages) $('alerte').hidden = true;
  $('comparer').setAttribute('aria-pressed', String(etat.comparer));
  $('etiquettes').hidden = !etat.comparer || pages;
  $('apercu').classList.toggle('comparer', etat.comparer);
  if (pages) afficherPlanche();
  $('note-apercu').textContent = !avecDocs ? 'Aperçu sur un document d’exemple. Ajoute un document pour voir le tien.'
    : pages ? (estRV(lotAffiche()) ? 'Recto + verso : seule la 1re page de chaque document est utilisée.'
      : 'Touche une page puis : pivoter, déplacer, retirer. Double-clic : la page filigranée.')
    : etat.comparer ? 'Fais glisser la ligne : l’original à gauche, le filigrane à droite.' : '';
  $('note-apercu').hidden = !$('note-apercu').textContent;

  $('phrase').textContent = `« ${texteFiligrane()} »`;
  const possible = etat.lots.some(pret) && $('destinataire').value.trim();
  $('filigraner').disabled = !possible && !etat.traitement;
  const n = etat.lots.filter(pret).length;
  $('filigraner').textContent = etat.traitement ? 'Annuler' : n > 1 ? `Filigraner (${n} fichiers)` : 'Filigraner';
  if (!etat.traitement && etat.lots.length && !$('destinataire').value.trim()) afficherStatut('Indique un destinataire pour pouvoir filigraner.');
  else if (!etat.traitement && $('statut').dataset.auto) afficherStatut('');
}

function afficherLots() {
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

function lien(texte, action) {
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

function afficherStatut(texte, erreur = false) {
  const s = $('statut');
  s.textContent = texte;
  s.classList.toggle('erreur', erreur);
  s.dataset.auto = texte && !erreur ? '1' : '';
}

// MARK: Taille estimée (d'après l'aperçu, comme l'app Mac)

const formatTaille = n => (n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

function majTaille() {
  const R = etat.R, e = etat.estimation;
  const cible = R.cible_ko * 1024;
  const lequel = etat.lots.length > 1 ? ' (ce fichier)' : '';
  let texte, attention = false;
  if (!e || !etat.lots.some(pret)) {
    texte = R.taille === 'limitee' ? 'La meilleure qualité possible sous cette limite, pour les sites et les messageries qui limitent la taille.'
      : 'Meilleure qualité.';
  } else {
    const k = dpi => Math.pow(dpi / e.dpi, 2 * EXPOSANT);
    const normale = (e.tailles.normale * k(R.qualite || 200) + SURCOUT_PAGE) * e.nb + SURCOUT_FIXE;
    if (R.taille !== 'limitee') texte = `Meilleure qualité · environ ${formatTaille(normale)}${lequel}.`;
    else if (normale <= cible) texte = `Environ ${formatTaille(normale)}${lequel} : déjà sous la limite, qualité intacte.`;
    else {
      const auMieux = (e.tailles.plancher * k(72) + SURCOUT_PAGE) * e.nb + SURCOUT_FIXE;
      attention = auMieux > cible;
      texte = attention ? `Impossible sous ${formatTaille(cible)}${lequel} : au mieux environ ${formatTaille(auMieux)}.`
        : `Qualité réduite juste ce qu’il faut pour passer sous ${formatTaille(cible)}${lequel}.`;
    }
  }
  $('note-taille').textContent = texte;
  $('note-taille').classList.toggle('attention', attention);
}

// MARK: Aperçu (dernière demande gagne ; le filigrane est calculé en arrière-plan)

let demande = 0, occupe = false;
let base = null;          // { cle, c } page sans filigrane, à la résolution de l'aperçu
let filigranee = null;    // la même page filigranée (image)

function demanderApercu() {
  demande++;
  if (!occupe) boucleApercu();
}

async function boucleApercu() {
  occupe = true;
  $('calcul').hidden = false;
  try {
    for (;;) {
      const n = demande;
      await new Promise(r => requestAnimationFrame(r));
      await calculerApercu();
      if (n === demande) break;
    }
  } catch (e) {
    afficherStatut('Aperçu impossible : ' + (e.message || e), true);
  }
  $('calcul').hidden = true;
  occupe = false;
}

const exemple = {
  w: A4.w, h: A4.h,
  dessiner(ctx, s) {
    ctx.save();
    ctx.scale(s, s);
    const t = (texte, x, y, taille) => { ctx.font = `${taille}px Helvetica, Arial, sans-serif`; ctx.fillStyle = '#000'; ctx.fillText(texte, x, y); };
    t('DOCUMENT D’EXEMPLE', 60, 70, 16);
    ctx.fillStyle = '#544d47'; ctx.fillRect(60, 95, 150, 195);
    ctx.fillStyle = '#d1ad99'; ctx.beginPath(); ctx.ellipse(135, 165, 40, 45, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#26334d'; ctx.fillRect(85, 210, 100, 80);
    ctx.fillStyle = '#dbe6f2'; ctx.fillRect(230, 95, 310, 195);
    ['Nom : SPECIMEN', 'Prénom : JEAN', 'Né le : 01.01.1980', 'N° X0X0X0X0X'].forEach((l, i) => t(l, 245, 130 + i * 40, 14));
    for (let i = 0; i < 30; i++) t(`Ligne ${String(i + 1).padStart(2, '0')}   Texte d’exemple pour juger la lisibilité ........ ${1234 * (i + 1)} EUR`, 60, 330 + i * 16, 10);
    ctx.restore();
  },
};

async function calculerApercu() {
  if (etat.vue === 'pages') return;
  const lot = lotAffiche();
  const liste = lot && pret(lot) ? pagesLot(lot) : [exemple];
  etat.page = Math.max(0, Math.min(etat.page, liste.length - 1));
  const page = liste[etat.page];
  const cadre = $('cadre-apercu');
  const largeur = Math.min(1400, Math.max(320, (cadre.clientWidth - 28) * (window.devicePixelRatio || 1)));
  // 100 dpi au moins (comme l'app Mac) : en dessous, le texte est trop fin pour juger la lisibilité
  const dpi = Math.max(100, Math.min(150, largeur / page.w * 72));
  const cle = `${lot && pret(lot) ? cleLot(lot) : 'exemple'}|${etat.page}|${dpi.toFixed(1)}`;
  if (base?.cle !== cle) {
    if (base) liberer(base.c);
    base = { cle, c: await rendrePage(page, dpi) };
  }
  const r = await filigranerApercu(base.c, texteFiligrane(), etat.R, etat.graine, etat.page, dpi);
  if (filigranee?.close) filigranee.close();
  filigranee = r.image;
  dessinerApercu();

  const a = alerte(r.mesures);
  $('alerte').hidden = !a || etat.comparer;
  if (a) {
    $('alerte-texte').textContent = a.texte;
    $('alerte-bouton').textContent = a.bouton;
    $('alerte-bouton').onclick = () => { etat.R.opacite = a.intensite; enregistrerReglages(); demanderApercu(); };
  }
  etat.estimation = lot && pret(lot) ? { tailles: r.tailles, dpi, nb: liste.length } : null;
  majTaille();
  $('pages').hidden = liste.length < 2;
  $('page-num').textContent = `Page ${etat.page + 1} sur ${liste.length}`;
  $('page-prec').disabled = etat.page === 0;
  $('page-suiv').disabled = etat.page >= liste.length - 1;
}

/** Dessine l'aperçu ; en mode Comparer, l'original à gauche de la ligne. */
function dessinerApercu() {
  if (!base || !filigranee) return;
  const el = $('apercu');
  const W = base.c.width, H = base.c.height;
  if (el.width !== W || el.height !== H) {
    el.width = W;
    el.height = H;
    el.style.setProperty('aspect-ratio', `${W} / ${H}`);
  }
  const ctx = el.getContext('2d');
  ctx.drawImage(filigranee, 0, 0);
  if (!etat.comparer) return;
  const x = W * etat.coupe;
  const k = W / Math.max(1, el.clientWidth);  // pixels du canvas par point d'écran
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, x, H);
  ctx.clip();
  ctx.drawImage(base.c, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4 * k;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 1.5 * k, 0, 3 * k, H);
  ctx.beginPath();
  ctx.arc(x, H / 2, 16 * k, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#555';
  ctx.font = `bold ${14 * k}px -apple-system, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ ›', x, H / 2);
}

// MARK: Filigraner

async function filigraner() {
  if (etat.traitement) { etat.arret = true; return; }
  const destinataire = $('destinataire').value.trim();
  if (!destinataire) return;
  const motif = $('motif').value.trim();
  memoriser(destinataire, motif);
  const lots = etat.lots.filter(pret);
  const cible = etat.R.taille === 'limitee' ? etat.R.cible_ko * 1024 : null;
  const texte = texteFiligrane();
  etat.traitement = true;
  etat.arret = false;
  majInterface();
  $('progression').hidden = false;
  $('progression').value = 0;
  afficherStatut('Filigrane en cours…');
  const resultats = [];
  try {
    for (const [k, lot] of lots.entries()) {
      const r = await produire(pagesLot(lot), texte, etat.R, {
        cible,
        avancement: f => { $('progression').value = (k + f) / lots.length; },
        arret: () => etat.arret,
      });
      resultats.push({ nom: nomFichier(lot), ...r });
    }
    afficherStatut('');
    montrerResultats(resultats, cible);
  } catch (e) {
    afficherStatut(e.message || String(e), true);
  } finally {
    etat.traitement = false;
    $('progression').hidden = true;
    majInterface();
  }
}

function montrerResultats(resultats, cible) {
  for (const r of etat.resultats) URL.revokeObjectURL(r.url);
  etat.resultats = resultats.map(r => ({ ...r, url: URL.createObjectURL(r.blob), fichier: new File([r.blob], r.nom, { type: 'application/pdf' }) }));
  $('t-resultats').textContent = resultats.length > 1 ? `${resultats.length} fichiers prêts` : 'Fichier prêt';
  $('liste-resultats').replaceChildren(...etat.resultats.map(r => {
    const li = document.createElement('li');
    li.className = 'resultat';
    const infos = document.createElement('div');
    infos.className = 'infos';
    const nom = document.createElement('div');
    nom.className = 'nom';
    nom.textContent = r.nom;
    const detail = document.createElement('div');
    detail.className = 'detail' + (r.respecte ? '' : ' attention');
    detail.textContent = r.respecte ? formatTaille(r.taille) : `${formatTaille(r.taille)} : impossible de descendre sous ${formatTaille(cible)}`;
    infos.append(nom, detail);
    const enregistrer = document.createElement('a');
    enregistrer.href = r.url;
    enregistrer.download = r.nom;
    enregistrer.textContent = 'Enregistrer';
    li.append(infos, enregistrer);
    if (navigator.canShare?.({ files: [r.fichier] })) li.append(lien('Partager', () => partagerFichiers([r.fichier])));
    return li;
  }));
  const fichiers = etat.resultats.map(r => r.fichier);
  const partage = !!navigator.canShare?.({ files: fichiers });
  $('tout-partager').hidden = !partage;
  $('tout-partager').textContent = fichiers.length > 1 ? 'Tout partager' : 'Partager';
  $('note-resultats').textContent = (partage ? 'Partager : Mail, Messages, AirDrop, Fichiers… ' : 'Enregistrer télécharge le PDF. ')
    + 'Rien n’a été envoyé jusqu’ici. Les documents restent dans la liste : change le destinataire pour un autre envoi.';
  $('resultats').showModal();
}

async function partagerFichiers(fichiers) {
  try {
    await navigator.share({ files: fichiers, title: $('motif').value.trim() || 'Documents' });
  } catch (e) {
    if (e.name !== 'AbortError') afficherStatut('Partage impossible : ' + e.message, true);
  }
}

function fermerResultats() {
  if ($('resultats').open) $('resultats').close();
}

// MARK: Branchements

function brancher() {
  $('choisir').addEventListener('change', e => { ajouter(e.target.files); e.target.value = ''; });

  // glisser des fichiers sur la page (ordinateur)
  addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('survol'); });
  addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('survol'); });
  addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('survol');
    if (e.dataTransfer?.files?.length) ajouter(e.dataTransfer.files);
  });

  // fichiers à produire
  $('selectionner').addEventListener('click', () => {
    if (etat.modeSelection) quitterSelection();
    else { etat.modeSelection = true; etat.selection.clear(); majInterface(); }
  });
  $('reunir').addEventListener('click', () => reunir());
  $('recto-verso').addEventListener('click', () => {
    const lot = rvCoche();
    if (!lot) { reunir(true); return; }
    etat.modeSelection = false;
    etat.selection.clear();
    modifierLots(() => { lot.rectoVerso = false; });
  });
  $('separer').addEventListener('click', separer);
  $('retirer').addEventListener('click', () => {
    const ids = new Set(etat.selection);
    etat.modeSelection = false;
    etat.selection.clear();
    retirerDocs(ids);
  });
  $('suggestion-oui').addEventListener('click', () => { etat.selection = new Set(etat.suggestion); reunir(true); });
  $('suggestion-non').addEventListener('click', () => { etat.suggestion = null; majInterface(); });

  // envoi
  $('destinataire').addEventListener('input', () => { appliquerAssociation(); majInterface(); demanderApercu(); });
  $('motif').addEventListener('input', () => { majInterface(); demanderApercu(); });
  $('destinataire').addEventListener('keydown', e => { if (e.key === 'Enter') $('motif').focus(); });
  $('motif').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('date').addEventListener('change', () => { majInterface(); demanderApercu(); });
  $('avec-date').addEventListener('change', e => { etat.R.date = e.target.checked; enregistrerReglages(); demanderApercu(); });

  // filigrane
  for (const r of document.getElementsByName('force')) {
    r.addEventListener('change', () => {
      [etat.R.opacite, etat.R.densite, etat.R.echelle] = FORCES[r.value];
      enregistrerReglages();
      demanderApercu();
    });
  }
  for (const cle of Object.keys(curseurs)) {
    $(cle).addEventListener('input', e => { etat.R[cle] = Number(e.target.value); enregistrerReglages(); demanderApercu(); });
  }
  for (const b of document.querySelectorAll('#couleurs button')) {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { etat.R.couleur = b.dataset.couleur; enregistrerReglages(); demanderApercu(); });
  }
  $('couleur-autre').addEventListener('input', e => { etat.R.couleur = e.target.value; enregistrerReglages(); demanderApercu(); });
  for (const r of document.getElementsByName('style')) {
    r.addEventListener('change', () => { etat.R.style = r.value; enregistrerReglages(); demanderApercu(); });
  }
  $('diagonales').addEventListener('change', e => { etat.R.diagonales = e.target.checked ? 2 : 1; enregistrerReglages(); demanderApercu(); });
  for (const cle of ['guilloche', 'micro_texte']) {
    $(cle).addEventListener('change', e => { etat.R[cle] = e.target.checked; enregistrerReglages(); demanderApercu(); });
  }
  $('defaut').addEventListener('click', () => {
    etat.R = { ...reglagesParDefaut, taille: etat.R.taille, cible_ko: etat.R.cible_ko };
    enregistrerReglages();
    demanderApercu();
  });
  for (const r of document.getElementsByName('taille')) {
    r.addEventListener('change', () => { etat.R.taille = r.value; enregistrerReglages(); });
  }
  $('cible').addEventListener('change', e => { etat.R.cible_ko = Number(e.target.value); enregistrerReglages(); });

  // aperçu, comparer, pages
  for (const r of document.getElementsByName('vue')) r.addEventListener('change', () => choisirVue(r.value));
  $('comparer').addEventListener('click', () => {
    etat.comparer = !etat.comparer;
    etat.coupe = 0.5;
    majInterface();
    demanderApercu();
  });
  let glisse = false;
  const suivre = e => {
    const r = $('apercu').getBoundingClientRect();
    etat.coupe = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    dessinerApercu();
  };
  $('apercu').addEventListener('pointerdown', e => {
    if (!etat.comparer) return;
    glisse = true;
    $('apercu').setPointerCapture(e.pointerId);
    suivre(e);
  });
  $('apercu').addEventListener('pointermove', e => { if (glisse) suivre(e); });
  $('apercu').addEventListener('pointerup', () => { glisse = false; });
  $('apercu').addEventListener('pointercancel', () => { glisse = false; });
  $('pivoter-g').addEventListener('click', () => pivoter(-1));
  $('pivoter-d').addEventListener('click', () => pivoter(1));
  $('avant').addEventListener('click', () => deplacerPage(-1));
  $('apres').addEventListener('click', () => deplacerPage(1));
  $('retirer-page').addEventListener('click', retirerOuRemettre);
  $('tirage').addEventListener('click', () => { etat.graine = (Math.random() * 4294967296) >>> 0; demanderApercu(); });
  $('page-prec').addEventListener('click', () => { etat.page--; demanderApercu(); });
  $('page-suiv').addEventListener('click', () => { etat.page++; demanderApercu(); });

  $('filigraner').addEventListener('click', filigraner);
  $('tout-partager').addEventListener('click', () => partagerFichiers(etat.resultats.map(r => r.fichier)));
  $('fermer-resultats').addEventListener('click', fermerResultats);
  $('resultats').addEventListener('click', e => { if (e.target === $('resultats')) fermerResultats(); });

  let largeur = innerWidth;
  addEventListener('resize', () => { if (Math.abs(innerWidth - largeur) > 40) { largeur = innerWidth; demanderApercu(); } });

  // conseil d'installation : Safari sur iPhone / iPad, pas encore installée
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installee = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let vu = false;
  try { vu = localStorage.getItem('filigrane.install') === 'vu'; } catch { /* rien */ }
  $('install').hidden = !ios || installee || vu;
  $('install-fermer').addEventListener('click', () => {
    $('install').hidden = true;
    try { localStorage.setItem('filigrane.install', 'vu'); } catch { /* rien */ }
  });
}

// fonctionne hors connexion une fois installée (le service worker garde l'app et pdf.js en cache)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const aujourdhui = new Date();
$('date').value = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, '0')}-${String(aujourdhui.getDate()).padStart(2, '0')}`;
$('details').open = !forceActuelle();  // réglage personnalisé : curseurs visibles
listesHistorique();
brancher();
majInterface();
demanderApercu();
