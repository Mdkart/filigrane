// calcul.js — confie le filigrane au calcul en arrière-plan (worker.js) quand le navigateur le permet
// (canvas hors écran avec texte), sinon le fait sur la page comme avant.

import {
  appliquer, melange, jpeg, produire as produireSurLaPage, rendrePage, liberer, canvas, assembler,
  QUALITE_NORMALE, QUALITE_PLANCHER,
} from './moteur.js';

let worker = null;
try {
  const essai = typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('2d');
  if (essai && typeof essai.fillText === 'function') worker = new Worker('worker.js', { type: 'module' });
} catch { worker = null; }

let prochain = 1;
const attentes = new Map();  // id → { ok, ko, progression }

if (worker) {
  worker.onmessage = e => {
    const { id, erreur, progression } = e.data;
    const a = attentes.get(id);
    if (!a) return;
    if (progression !== undefined) { a.progression?.(progression); return; }
    attentes.delete(id);
    if (erreur) a.ko(new Error(erreur)); else a.ok(e.data);
  };
  // worker refusé (ancien navigateur) : on repasse sur la page, les demandes en cours échouent proprement
  worker.onerror = () => {
    worker = null;
    for (const a of attentes.values()) a.ko(new Error('calcul en arrière-plan indisponible'));
    attentes.clear();
  };
}

function demander(message, transfert = [], progression) {
  return new Promise((ok, ko) => {
    const id = prochain++;
    attentes.set(id, { ok, ko, progression });
    worker.postMessage({ id, ...message }, transfert);
  });
}

export const enArrierePlan = () => !!worker;

/**
 * Aperçu filigrané d'une page déjà rendue (canvas `base`, non modifié).
 * Renvoie { image (à dessiner), mesures, tailles: { normale, plancher } }.
 */
export async function apercu(base, texte, R, graine, page, dpi) {
  if (worker) {
    try {
      const bitmap = await createImageBitmap(base);
      return await demander({ type: 'apercu', bitmap, texte, R, graine, page, dpi }, [bitmap]);
    } catch (e) {
      if (!worker) return apercu(base, texte, R, graine, page, dpi);
      throw e;
    }
  }
  const c = canvas(base.width, base.height);
  c.getContext('2d').drawImage(base, 0, 0);
  const mesures = appliquer(c, texte, R, melange(graine, page), dpi);
  const tailles = { normale: (await jpeg(c, QUALITE_NORMALE)).size, plancher: (await jpeg(c, QUALITE_PLANCHER)).size };
  return { image: c, mesures, tailles };
}

/** Comme moteur.produire, mais le filigrane et l'encodage se font en arrière-plan. */
export async function produire(pages, texte, R, { cible = null, avancement = () => {}, arret = () => false } = {}) {
  if (!worker) return produireSurLaPage(pages, texte, R, { cible, avancement, arret });
  const graine = (Math.random() * 4294967296) >>> 0;
  const dpi = R.qualite || 200;
  const part = cible ? 0.7 : 1;
  const jpegs = [], rendues = [];
  for (const [i, p] of pages.entries()) {
    if (arret()) throw new Error('Traitement annulé.');
    const base = await rendrePage(p, dpi);
    const bitmap = await createImageBitmap(base);
    liberer(base);
    const r = await demander({ type: 'page', bitmap, texte, R, graine, index: i, dpi,
      qualite: cible ? 0.95 : QUALITE_NORMALE }, [bitmap]);
    if (cible) rendues.push({ w: p.w, h: p.h, jpeg: r.blob });
    else jpegs.push({ w: p.w, h: p.h, pw: r.pw, ph: r.ph, jpeg: r.blob });
    avancement((i + 1) / pages.length * part);
  }
  if (!cible) {
    const blob = await assembler(jpegs);
    return { blob, taille: blob.size, respecte: true };
  }
  const { resultat } = await demander({ type: 'viser', rendues, dpi, cible }, [],
    f => avancement(part + (1 - part) * f));
  return resultat;
}
