// app.js — interface de la version web de Filigrane (même logique que l'app Mac 3.5) : envoi, réglages,
// aperçu (avant / après), estimation de la taille, Filigraner. Fichiers à produire : lots.js ; planche des
// pages : planche.js ; état partagé : etat.js.

import {
  A4, reglagesParDefaut, phrase, rendrePage, alerte, liberer, SURCOUT_PAGE, SURCOUT_FIXE, EXPOSANT,
} from './moteur.js';
import { apercu as filigranerApercu, produire } from './calcul.js';
import {
  $, FORCES, TAILLES, ecrire, etat, pret, estRV, pagesLot, cleLot, lotAffiche, nomFichier,
} from './etat.js';
import {
  ajouter, modifierLots, reunir, separer, retirerDocs, quitterSelection, rvCoche, afficherLots, lien,
} from './lots.js';
import { pivoter, retirerOuRemettre, deplacerPage, afficherPlanche, choisirVue } from './planche.js';

const motifsPredefinis = ['Dossier de location', 'Ouverture de compte bancaire', 'Dossier de prêt',
  'Notaire', 'Assurance', 'Employeur', 'Administration'];

// MARK: Texte, historique

const texteFiligrane = () => phrase($('destinataire').value, $('motif').value, etat.R.date ? dateChoisie() : null);

/** Date au format du champ (AAAA-MM-JJ, heure locale). */
function jour(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

export function majInterface() {
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
  // date : aujourd'hui, autre date ou sans date ; taille : normale, une limite courante ou autre
  const choixDate = !R.date ? 'sans' : etat.dateAutre || $('date').value !== jour(new Date()) ? 'autre' : 'aujourdhui';
  $('choix-date').value = choixDate;
  $('ligne-date').hidden = choixDate !== 'autre';
  const autreTaille = etat.cibleAutre || !TAILLES.includes(R.cible_ko);
  $('taille').value = R.taille !== 'limitee' ? '0' : autreTaille ? '-1' : String(R.cible_ko);
  $('ligne-cible').hidden = R.taille !== 'limitee' || !autreTaille;
  if (document.activeElement !== $('cible-mo')) $('cible-mo').value = String(Math.round(R.cible_ko / 1024 * 10) / 10).replace('.', ',');
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

  // sans document : l'accueil à la place de l'aperçu (l'exemple à la demande)
  const accueil = !etat.lots.length && !etat.voirExemple;
  $('accueil').hidden = !accueil;
  document.querySelector('.zone-apercu').hidden = accueil;

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
  // actif même sans destinataire : un appui amène alors sur le champ (pas de bouton grisé muet)
  $('filigraner').disabled = !etat.lots.some(pret) && !etat.traitement;
  const n = etat.lots.filter(pret).length;
  $('filigraner').textContent = etat.traitement ? 'Annuler' : n > 1 ? `Filigraner (${n} fichiers)` : 'Filigraner';
  if (!etat.traitement && $('statut').dataset.auto) afficherStatut('');
}

export function afficherStatut(texte, erreur = false) {
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

export function demanderApercu() {
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
  if (etat.vue === 'pages' || !$('accueil').hidden) return;
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
  if (!destinataire) { reclamerDestinataire(); return; }
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

/** Filigraner sans destinataire : le champ défile en vue, prend le focus (clavier sur iPhone) et s'entoure. */
function reclamerDestinataire() {
  const champ = $('destinataire');
  const ligne = champ.closest('.ligne');
  champ.focus();
  ligne.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  ligne.classList.remove('signale');
  void ligne.offsetWidth;  // relance l'animation
  ligne.classList.add('signale');
  setTimeout(() => ligne.classList.remove('signale'), 1600);
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

export function fermerResultats() {
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
  $('choix-date').addEventListener('change', e => {
    const v = e.target.value;
    etat.R.date = v !== 'sans';
    etat.dateAutre = v === 'autre';
    if (v === 'aujourdhui') $('date').value = jour(new Date());
    enregistrerReglages();
    demanderApercu();
  });
  $('taille').addEventListener('change', e => {
    const v = Number(e.target.value);
    etat.cibleAutre = v === -1;
    if (v > 0) etat.R.cible_ko = v;
    etat.R.taille = v === 0 ? 'normale' : 'limitee';
    enregistrerReglages();
  });
  $('cible-mo').addEventListener('change', e => {
    const mo = Number(String(e.target.value).replace(',', '.'));
    if (mo > 0) etat.R.cible_ko = Math.min(51200, Math.max(100, Math.round(mo * 1024)));
    enregistrerReglages();
  });
  $('voir-exemple').addEventListener('click', () => { etat.voirExemple = true; majInterface(); demanderApercu(); });

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

$('date').value = jour(new Date());
$('details').open = !forceActuelle();  // réglage personnalisé : curseurs visibles
listesHistorique();
brancher();
majInterface();
demanderApercu();
