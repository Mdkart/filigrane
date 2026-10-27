// Service worker : garde l'app et pdf.js en cache pour qu'elle marche hors connexion.
// Aucun document ne passe par ici : les fichiers choisis ne quittent jamais la page.
const VERSION = 'filigrane-2';  // à changer à chaque mise à jour : les iPhone reprennent alors la nouvelle version
const APP = ['./', 'index.html', 'style.css', 'app.js', 'moteur.js', 'calcul.js', 'worker.js', 'manifest.webmanifest',
  'icone-180.png', 'icone-192.png', 'icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(c => c !== VERSION).map(c => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // pdf.js (version figée) : le cache d'abord
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(rep => {
      const copie = rep.clone();
      caches.open(VERSION).then(c => c.put(e.request, copie));
      return rep;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  // l'app : le réseau d'abord (mises à jour), le cache hors connexion
  e.respondWith(fetch(e.request).then(rep => {
    const copie = rep.clone();
    caches.open(VERSION).then(c => c.put(e.request, copie));
    return rep;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
