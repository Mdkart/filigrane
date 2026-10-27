// moteur.js — moteur de Filigrane pour le navigateur (portage de Sources/Moteur).
//
// Même principe que l'app Mac : le filigrane est dessiné sur l'image de chaque page, puis la page est
// aplatie en JPEG dans un nouveau PDF. Texte répété en deux diagonales, ondulé, irrégulier lettre par
// lettre, fond guilloché, variations d'intensité, couleur adaptative (zones sombres), micro-texte.
// Tout se passe dans le navigateur : aucun fichier n'est envoyé. Rendu proche de l'app Mac, pas identique
// au pixel près (polices et JPEG du navigateur).

export const A4 = { w: 595, h: 842 };

export const reglagesParDefaut = Object.freeze({
  opacite: 0.35, couleur: '#737373', echelle: 1, densite: 1, angle: 35,
  style: 'ondule', diagonales: 2, guilloche: true, date: true, micro_texte: true,
  taille: 'normale', cible_ko: 2048, qualite: 200,
});

// qualités JPEG du navigateur (≈ libjpeg) : 0,85 ≈ qualité « normale » de l'app Mac
export const QUALITE_NORMALE = 0.85;
const QUALITE_MINI = 0.55;      // en dessous, on baisse plutôt la résolution
export const QUALITE_PLANCHER = 0.3;   // dernier recours, à la plus basse résolution
export const DPI_REDUITS = [150, 130, 110, 96, 80, 72];
export const SURCOUT_PAGE = 400, SURCOUT_FIXE = 600;  // octets du PDF autour des JPEG
export const EXPOSANT = 0.78;   // taille d'un JPEG ∝ (dpi)^(2 × exposant), comme dans l'app Mac

// MARK: Hasard reproductible (même graine, même tirage : l'aperçu ne « saute » pas)

export function hasard(graine) {
  let a = graine >>> 0;
  const reel = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const h = {
    reel,
    uniforme: (x, y) => x + (y - x) * reel(),
    suivant: () => Math.floor(reel() * 4294967296) >>> 0,
    gauss: (m, e) => m + e * Math.sqrt(-2 * Math.log(Math.max(reel(), 1e-12))) * Math.cos(2 * Math.PI * reel()),
    enfant: () => hasard(h.suivant()),
  };
  return h;
}

/** Générateur déterminé par plusieurs valeurs (ex. graine, ligne, répétition). */
export function melange(...valeurs) {
  let h = 0x243F6A88;
  for (const v of valeurs) h = hasard((h ^ v) >>> 0).suivant();
  return hasard(h);
}

// MARK: Texte du filigrane

export function dateFr(d) {
  const z = n => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** « Document destiné exclusivement à {destinataire} - {motif} - {date} » */
export function phrase(destinataire, motif, date) {
  const d = destinataire.trim(), m = motif.trim();
  const morceaux = [d ? `Document destiné exclusivement à ${d}` : 'Copie - usage exclusif'];
  if (m) morceaux.push(m);
  if (date) morceaux.push(dateFr(date));
  return morceaux.join(' - ');
}

// MARK: Documents

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/';
let pdfjs = null;

async function chargerPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(PDFJS + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  }
  return pdfjs;
}

function chargerImage(fichier) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error('image illisible (format non pris en charge par ce navigateur ?)'));
    img.src = URL.createObjectURL(fichier);
  });
}

export const estPDF = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/**
 * Pages d'un fichier : { w, h } en points et dessiner(ctx, echelle).
 * Les formulaires remplis et annotations du PDF sont dessinés (mode « impression » de pdf.js).
 */
export async function ouvrir(fichier) {
  if (estPDF(fichier)) {
    const lib = await chargerPdfjs();
    let doc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()), isEvalSupported: false }).promise;
    } catch (e) {
      throw new Error(e?.name === 'PasswordException' ? 'PDF protégé par un mot de passe' : 'PDF illisible');
    }
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      pages.push({
        w: vp.width, h: vp.height,
        dessiner: (ctx, s) => page.render({
          canvasContext: ctx, viewport: page.getViewport({ scale: s }),
          annotationMode: lib.AnnotationMode.ENABLE_STORAGE, background: 'white',
        }).promise,
      });
    }
    return pages;
  }
  // image (orientation de l'appareil photo appliquée par le navigateur) : ramenée au format A4 au plus
  const img = await chargerImage(fichier);
  const red = Math.min(1, A4.h / Math.max(img.naturalWidth, img.naturalHeight));
  const w = img.naturalWidth * red, h = img.naturalHeight * red;
  return [{
    w, h,
    dessiner(ctx, s) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w * s, h * s);
    },
  }];
}

/** Page tournée de `quarts` quarts de tour dans le sens des aiguilles d'une montre. La page d'origine est
 *  rendue à part puis posée tournée : pdf.js n'aime pas dessiner dans un contexte déjà transformé. */
export function tourner(p, quarts) {
  const q = ((quarts % 4) + 4) % 4;
  if (!q) return p;
  const w = q % 2 ? p.h : p.w, h = q % 2 ? p.w : p.h;
  return {
    w, h,
    async dessiner(ctx, s) {
      const c = await rendrePage(p, 72 * s);
      ctx.save();
      if (q === 1) { ctx.translate(w * s, 0); ctx.rotate(Math.PI / 2); }
      else if (q === 2) { ctx.translate(w * s, h * s); ctx.rotate(Math.PI); }
      else { ctx.translate(0, h * s); ctx.rotate(-Math.PI / 2); }
      ctx.drawImage(c, 0, 0, p.w * s, p.h * s);
      ctx.restore();
      liberer(c);
    },
  };
}

/** Les 1res pages de deux documents (recto, verso) l'une sous l'autre sur une page A4. */
export function rectoVerso(p1, p2) {
  const marge = 40, ecart = 28, h = (A4.h - 2 * marge - ecart) / 2;
  return {
    w: A4.w, h: A4.h,
    async dessiner(ctx, s) {
      for (const [i, p] of [p1, p2].entries()) {
        const cadre = { x: marge, y: marge + i * (h + ecart), w: A4.w - 2 * marge, h };
        const k = Math.min(cadre.w / p.w, cadre.h / p.h);
        // page dessinée à part puis posée : pdf.js gère mal un contexte déjà transformé
        const c = await rendrePage(p, 72 * s * k);
        ctx.drawImage(c, (cadre.x + (cadre.w - p.w * k) / 2) * s, (cadre.y + (cadre.h - p.h * k) / 2) * s);
        liberer(c);
      }
    },
  };
}

// MARK: Images

/** Canvas sur la page, ou hors écran dans le calcul en arrière-plan (worker : pas de document). */
export function canvas(w, h) {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Libère tout de suite la mémoire d'un canvas (iOS limite la mémoire totale des canvas). */
export function liberer(c) {
  c.width = 0;
  c.height = 0;
}

/** Rendu d'une page à la résolution demandée, sur fond blanc. */
export async function rendrePage(page, dpi) {
  const s = dpi / 72;
  const c = canvas(Math.max(1, Math.round(page.w * s)), Math.max(1, Math.round(page.h * s)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.dessiner(ctx, s);
  return c;
}

// Calques en niveaux de gris (0 = rien, 255 = filigrane plein), une valeur par pixel

function calqueDessin(w, h, dessin) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  dessin(ctx);
  const d = ctx.getImageData(0, 0, w, h).data;
  liberer(c);
  const v = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < v.length; i++, j += 4) v[i] = d[j];
  return v;
}

function table(f) {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.min(255, Math.max(0, f(i)));
  return t;
}

function fois(v, k) {
  const t = table(x => x * k);
  for (let i = 0; i < v.length; i++) v[i] = t[v[i]];
}

function eclaircir(v, autre) {
  for (let i = 0; i < v.length; i++) if (autre[i] > v[i]) v[i] = autre[i];
}

function multiplier(v, autre) {
  for (let i = 0; i < v.length; i++) v[i] = (v[i] * autre[i] / 255) | 0;
}

// MARK: Filigrane

const POLICES = ['Helvetica, Arial, sans-serif', 'Georgia, "Times New Roman", serif'];

/** Texte répété, incliné, irrégulier lettre par lettre ; un générateur par ligne et par répétition. */
function trameTexte(w, h, texte, px, angle, r0, pasY, melangePolices, avances) {
  const cote = Math.floor(Math.hypot(w, h)) + 4 * px;
  const base = r0.suivant();
  const depart = r0.uniforme(0, px * pasY);
  const caracteres = Array.from(texte);
  return calqueDessin(w, h, ctx => {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-angle * Math.PI / 180);
    ctx.translate(-cote / 2, -cote / 2);
    let y = -depart, ligne = 0;
    while (y < cote) {
      const rl = melange(base, ligne);
      let x = -rl.uniforme(0, cote / 3), rep = 0;
      while (x < cote) {
        const r = melange(base, ligne, rep + 1000003);
        const famille = melangePolices && r.reel() < 0.35 ? 1 : 0;
        const taille = Math.max(4, Math.round(px * r.uniforme(0.88, 1.12)));
        ctx.font = `${taille}px ${POLICES[famille]}`;
        for (const c of caracteres) {
          const k = r.uniforme(0.93, 1.07);           // taille de la lettre
          const decalage = r.uniforme(-0.09, 0.09) * px;
          const gris = Math.round(255 * r.uniforme(0.75, 1));
          const cle = `${famille}|${taille}|${c}`;
          let avance = avances.get(cle);
          if (avance === undefined) avances.set(cle, avance = ctx.measureText(c).width);
          if (c.trim()) {
            ctx.fillStyle = `rgb(${gris},${gris},${gris})`;
            ctx.save();
            ctx.translate(x, y + decalage);
            ctx.scale(k, k);
            ctx.fillText(c, 0, 0);
            ctx.restore();
          }
          x += avance * k * r.uniforme(0.97, 1.10);
        }
        x += px * r.uniforme(2.0, 4.5);
        rep++;
      }
      y += px * pasY * rl.uniforme(0.85, 1.15);
      ligne++;
    }
  });
}

/** Déforme le calque selon plusieurs vagues superposées. */
function onduler(m, w, h, px, r, force = 1) {
  const a1 = px * 0.55 * force, a2 = px * 0.25 * force;
  const l1 = px * r.uniforme(7, 12), l2 = px * r.uniforme(9, 15);
  const l3 = px * r.uniforme(18, 30), l4 = px * r.uniforme(4, 6);
  const p = [0, 1, 2, 3].map(() => r.uniforme(0, 2 * Math.PI));
  // tables des sinus : dx dépend de y et de x+y, dy de x et de x−y
  const s1 = new Float32Array(h), s2 = new Float32Array(w);
  const s3 = new Float32Array(w + h), s4 = new Float32Array(w + h);
  for (let y = 0; y < h; y++) s1[y] = a1 * Math.sin(2 * Math.PI * y / l1 + p[0]);
  for (let x = 0; x < w; x++) s2[x] = a1 * Math.sin(2 * Math.PI * x / l2 + p[1]);
  for (let i = 0; i < w + h; i++) {
    s3[i] = a2 * Math.sin(2 * Math.PI * i / l3 + p[2]);
    s4[i] = a2 * Math.sin(2 * Math.PI * (i - h) / l4 + p[3]);
  }
  const sortie = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + s1[y] + s3[x + y];
      const sy = y + s2[x] + s4[x - y + h];
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
      const v = m[i] * (1 - fx) * (1 - fy) + m[i + 1] * fx * (1 - fy)
        + m[i + w] * (1 - fx) * fy + m[i + w + 1] * fx * fy;
      sortie[y * w + x] = v > 255 ? 255 : v;
    }
  }
  return sortie;
}

/** Fines lignes sinueuses entrelacées (façon billet de banque). */
function guilloche(w, h, px, r) {
  const familles = [0, 1].map(f => [px * r.uniforme(5, 8), px * r.uniforme(13, 20), px * r.uniforme(0.5, 0.8),
    px * r.uniforme(0.6, 1.0), r.uniforme(0, 2 * Math.PI) + f * Math.PI]);
  return calqueDessin(w, h, ctx => {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1, Math.floor(px / 22));
    ctx.lineJoin = 'round';
    for (const [l1, l2, a1, a2, phi] of familles) {
      for (let y0 = -2 * px, k = 0; y0 < h + 2 * px; y0 += px * 0.9, k++) {
        ctx.beginPath();
        for (let x = 0; x <= w + 8; x += 8) {
          const y = y0 + a1 * Math.sin(2 * Math.PI * x / l1 + phi + k * 0.35) + a2 * Math.sin(2 * Math.PI * x / l2 + phi * 1.7);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  });
}

/** Variations douces d'intensité sur la page. */
function modulation(w, h, r, mini = 0.68) {
  const pw = Math.max(2, Math.floor(w / 90)), ph = Math.max(2, Math.floor(h / 90));
  const petit = canvas(pw, ph);
  const pc = petit.getContext('2d');
  const id = pc.createImageData(pw, ph);
  for (let i = 0; i < pw * ph; i++) {
    const v = Math.max(0, Math.min(255, r.gauss(128, 70)));
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  pc.putImageData(id, 0, 0);
  const v = calqueDessin(w, h, ctx => {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(petit, 0, 0, w, h);
  });
  liberer(petit);
  const t = table(x => 255 * (mini + (1 - mini) * x / 255));
  for (let i = 0; i < v.length; i++) v[i] = t[v[i]];
  return v;
}

/** Lignes de texte minuscule (~1,6 pt) en haut et en bas : brouillées par une photocopie ou une recopie. */
function microTexte(w, h, texte, dpi, opacite, r) {
  const px = Math.max(5, Math.round(1.6 * dpi / 72));
  const encre = Math.round(255 * Math.min(1, opacite * 1.6));
  return calqueDessin(w, h, ctx => {
    ctx.font = `${px}px ${POLICES[1]}`;
    ctx.fillStyle = `rgb(${encre},${encre},${encre})`;
    const s = texte + '  •  ';
    const pas = ctx.measureText(s).width;
    const depart = r.uniforme(0, pas);
    for (const y of [h * 0.015 + px * 0.75, h * 0.985 - px * 0.25]) {
      for (let x = -depart; x < w && pas > 0; x += pas) ctx.fillText(s, x, y);
    }
  });
}

/** Applique le filigrane sur le canvas d'une page ; renvoie de quoi juger sa lisibilité. */
export function appliquer(c, texte, R, rng, dpi) {
  const w = c.width, h = c.height;
  const taillePt = Math.max(9, Math.min(w, h) * 72 / dpi / 32);
  const px = Math.max(8, Math.floor(taillePt * R.echelle * dpi / 72));
  const k = 1 / Math.max(0.25, R.densite);
  // un générateur par élément : changer le texte ou un réglage ne rebat pas le reste
  const sous = Array.from({ length: 9 }, () => rng.enfant());
  const angle = R.angle + sous[0].uniforme(-4, 4);
  const angle2 = -angle + sous[0].uniforme(-6, 6);
  const ondule = R.style === 'ondule';
  const avances = new Map();

  let m = trameTexte(w, h, texte, px, angle, sous[1], 5 * k, ondule, avances);
  if (ondule) m = onduler(m, w, h, px, sous[2]);
  fois(m, R.opacite);
  if (R.diagonales === 2) {
    const px2 = Math.floor(px * 0.8);
    let m2 = trameTexte(w, h, texte, px2, angle2, sous[3], 7 * k, ondule, avances);
    if (ondule) m2 = onduler(m2, w, h, px2, sous[4], 1.2);
    fois(m2, R.opacite * 0.55);
    eclaircir(m, m2);
  }
  if (R.guilloche) {
    let g = guilloche(w, h, px, sous[5]);
    if (ondule) g = onduler(g, w, h, px, sous[6], 0.6);
    fois(g, R.opacite * 0.45);
    eclaircir(m, g);
  }
  multiplier(m, modulation(w, h, sous[7]));
  if (R.micro_texte) eclaircir(m, microTexte(w, h, texte, dpi, R.opacite, sous[8]));
  return colorer(c, m, R.couleur);
}

function flouGaussien(v, w, h, sigma) {
  const r = Math.ceil(sigma * 3);
  const noyau = [];
  for (let k = -r; k <= r; k++) noyau.push(Math.exp(-k * k / (2 * sigma * sigma)));
  const total = noyau.reduce((a, b) => a + b, 0);
  for (let i = 0; i < noyau.length; i++) noyau[i] /= total;
  const tmp = new Float32Array(v.length), sortie = new Float32Array(v.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += v[y * w + Math.min(w - 1, Math.max(0, x + k))] * noyau[k + r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x] * noyau[k + r];
    sortie[y * w + x] = s;
  }
  return sortie;
}

/** Couleur adaptative : foncée sur fond clair, claire sur fond sombre (photo d'identité). */
function colorer(c, masque, couleur) {
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const hex = parseInt((/^#[0-9a-f]{6}$/i.test(couleur) ? couleur : '#737373').slice(1), 16);
  const rvb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const clair = rvb.map(v => v + (255 - v) * 0.8);

  // zones sombres, sur une grille 8 fois plus petite, adoucies
  const pw = Math.max(1, Math.floor(w / 8)), ph = Math.max(1, Math.floor(h / 8));
  let zones = new Float32Array(pw * ph);
  for (let gy = 0; gy < ph; gy++) for (let gx = 0; gx < pw; gx++) {
    let somme = 0, n = 0;
    const y1 = Math.max(Math.floor(gy * h / ph) + 1, Math.floor((gy + 1) * h / ph));
    const x1 = Math.max(Math.floor(gx * w / pw) + 1, Math.floor((gx + 1) * w / pw));
    for (let y = Math.floor(gy * h / ph); y < y1; y++) {
      for (let x = Math.floor(gx * w / pw); x < x1; x += 2) {
        const i = (y * w + x) * 4;
        somme += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        n++;
      }
    }
    zones[gy * pw + gx] = somme / Math.max(1, n) < 115 ? 1 : 0;
  }
  zones = flouGaussien(zones, pw, ph, 2);

  let encre = 0, sombres = 0, ecart = 0;
  for (let y = 0; y < h; y++) {
    const gyf = Math.max(0, Math.min(ph - 1, (y + 0.5) * ph / h - 0.5));
    const gy0 = Math.floor(gyf), gy1 = Math.min(ph - 1, gy0 + 1), fy = gyf - gy0;
    for (let x = 0; x < w; x++) {
      const a = masque[y * w + x] / 255;
      const gxf = Math.max(0, Math.min(pw - 1, (x + 0.5) * pw / w - 0.5));
      const gx0 = Math.floor(gxf), gx1 = Math.min(pw - 1, gx0 + 1), fx = gxf - gx0;
      const z = zones[gy0 * pw + gx0] * (1 - fx) * (1 - fy) + zones[gy0 * pw + gx1] * fx * (1 - fy)
        + zones[gy1 * pw + gx0] * (1 - fx) * fy + zones[gy1 * pw + gx1] * fx * fy;
      if (z > 0.5) sombres++;
      if (a === 0) continue;
      encre += a;
      const i = (y * w + x) * 4;
      let avant = 0, apres = 0;
      for (let k = 0; k < 3; k++) {
        const teinte = rvb[k] * (1 - z) + clair[k] * z;
        const v = px[i + k] * (1 - a) + teinte * a;
        const poids = k === 0 ? 0.299 : k === 1 ? 0.587 : 0.114;
        avant += px[i + k] * poids;
        apres += v * poids;
        px[i + k] = v;
      }
      if (z > 0.5) ecart += Math.abs(apres - avant);
    }
  }
  ctx.putImageData(image, 0, 0);
  const total = Math.max(1, w * h);
  return { couverture: encre / total, zoneSombre: sombres / total, contrasteSombre: sombres ? ecart / sombres : 0 };
}

/** Conseil de lisibilité (mêmes seuils que l'app Mac). */
export function alerte(m) {
  if (!m) return null;
  if (m.couverture > 0.05) return { texte: 'Filigrane très marqué : le document risque d’être difficile à lire.', bouton: 'Alléger', intensite: 0.35 };
  if (m.zoneSombre > 0.02 && m.contrasteSombre < 2) return { texte: 'Filigrane peu visible sur la photo : il pourrait être retouché.', bouton: 'Renforcer', intensite: 0.4 };
  if (m.couverture < 0.008) return { texte: 'Filigrane très discret : il pourrait être effacé ou recadré.', bouton: 'Renforcer', intensite: 0.35 };
  return null;
}

// MARK: Production du PDF

export function jpeg(c, qualite) {
  if (c.convertToBlob) return c.convertToBlob({ type: 'image/jpeg', quality: qualite });  // hors écran
  return new Promise((ok, ko) => c.toBlob(b => (b ? ok(b) : ko(new Error('encodage JPEG impossible'))), 'image/jpeg', qualite));
}

function reduire(c, facteur) {
  if (facteur >= 1) return c;
  const r = canvas(Math.max(1, Math.round(c.width * facteur)), Math.max(1, Math.round(c.height * facteur)));
  const ctx = r.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, r.width, r.height);
  return r;
}

/** PDF dont chaque page est une image JPEG insérée telle quelle (filtre DCTDecode). */
export async function assembler(pages) {
  const morceaux = [];
  const decalages = [];
  let position = 0;
  const ecrire = m => {
    const octets = typeof m === 'string' ? new TextEncoder().encode(m) : m;
    morceaux.push(octets);
    position += octets.length;
  };
  const objet = (n, contenu) => {
    decalages[n] = position;
    ecrire(`${n} 0 obj\n`);
    for (const m of contenu) ecrire(m);
    ecrire('\nendobj\n');
  };
  ecrire('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  objet(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  objet(2, [`<< /Type /Pages /Count ${n} /Kids [${kids}] >>`]);
  for (const [i, p] of pages.entries()) {
    const o = 3 + i * 3;
    const w = p.w.toFixed(2), h = p.h.toFixed(2);
    const flux = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    const donnees = new Uint8Array(await p.jpeg.arrayBuffer());
    objet(o, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${o + 2} 0 R >> >> /Contents ${o + 1} 0 R >>`]);
    objet(o + 1, [`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`]);
    objet(o + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${donnees.length} >>\nstream\n`, donnees, '\nendstream']);
  }
  const xref = position;
  const total = 3 + n * 3;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let k = 1; k < total; k++) table += `${String(decalages[k]).padStart(10, '0')} 00000 n \n`;
  ecrire(table);
  ecrire(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(morceaux, { type: 'application/pdf' });
}

async function encoder(images, qualite) {
  const pages = [];
  for (const im of images) pages.push({ w: im.w, h: im.h, pw: im.c.width, ph: im.c.height, jpeg: await jpeg(im.c, qualite) });
  return pages;
}

const poids = pages => pages.reduce((t, p) => t + p.jpeg.size + SURCOUT_PAGE, SURCOUT_FIXE);

/**
 * Filigrane toutes les pages et produit le PDF. `cible` : taille maximale en octets (null : normale).
 * `avancement(0…1)` ; `arret()` vrai pour interrompre.
 */
export async function produire(pages, texte, R, { cible = null, avancement = () => {}, arret = () => false } = {}) {
  const graine = (Math.random() * 4294967296) >>> 0;
  const dpi = R.qualite || 200;
  const part = cible ? 0.7 : 1;
  const rendues = [];   // taille limitée : pages gardées pour les essais (JPEG très fin, pour la mémoire)
  const jpegs = [];
  for (const [i, p] of pages.entries()) {
    if (arret()) throw new Error('Traitement annulé.');
    const c = await rendrePage(p, dpi);
    appliquer(c, texte, R, melange(graine, i), dpi);
    if (cible) rendues.push({ w: p.w, h: p.h, jpeg: await jpeg(c, 0.95) });
    else jpegs.push({ w: p.w, h: p.h, pw: c.width, ph: c.height, jpeg: await jpeg(c, QUALITE_NORMALE) });
    liberer(c);
    avancement((i + 1) / pages.length * part);
    await new Promise(r => setTimeout(r, 0));  // laisse respirer l'interface
  }
  if (!cible) {
    const blob = await assembler(jpegs);
    return { blob, taille: blob.size, respecte: true };
  }
  return viser(rendues, dpi, cible, f => avancement(part + (1 - part) * f), arret);
}

/** Meilleure qualité sous la cible : dichotomie sur la qualité JPEG, palier de résolution par palier. */
export async function viser(rendues, dpiRendu, cible, avancement, arret) {
  const paliers = [dpiRendu, ...DPI_REDUITS.filter(d => d < dpiRendu)];
  for (const [n, dpi] of paliers.entries()) {
    if (arret()) throw new Error('Traitement annulé.');
    avancement(n / paliers.length);
    const images = [];
    for (const r of rendues) {
      const bitmap = await createImageBitmap(r.jpeg);
      const c = canvas(Math.max(1, Math.round(bitmap.width * dpi / dpiRendu)), Math.max(1, Math.round(bitmap.height * dpi / dpiRendu)));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close?.();
      images.push({ w: r.w, h: r.h, c });
    }
    const dernier = n === paliers.length - 1;
    const bas = dernier ? QUALITE_PLANCHER : QUALITE_MINI;
    let q = QUALITE_NORMALE;
    let meilleur = await encoder(images, q);
    let resultat = null;
    if (poids(meilleur) > cible) {
      const auPlusBas = await encoder(images, bas);
      if (poids(auPlusBas) > cible) {
        if (dernier) {
          const blob = await assembler(auPlusBas);
          resultat = { blob, taille: blob.size, respecte: blob.size <= cible };
        }
      } else {
        [q, meilleur] = [bas, auPlusBas];
        let haut = QUALITE_NORMALE;
        for (let k = 0; k < 5; k++) {
          const milieu = (q + haut) / 2;
          const p = await encoder(images, milieu);
          if (poids(p) <= cible) [q, meilleur] = [milieu, p]; else haut = milieu;
        }
      }
    }
    if (!resultat && poids(meilleur) <= cible) {
      const blob = await assembler(meilleur);
      resultat = { blob, taille: blob.size, respecte: blob.size <= cible };
    }
    images.forEach(i => liberer(i.c));
    if (resultat) return resultat;
  }
  throw new Error('document vide');
}
