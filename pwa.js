/* Installable web app: register the offline cache when served from a web address.
   Not used for file:// pages or the desktop (Electron) app. */
(() => {
  'use strict';
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || window.SolidDesktop) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
})();
