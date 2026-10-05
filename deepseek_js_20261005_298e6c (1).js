// حداقل Service Worker برای نصب‌پذیری؛ همیشه از شبکه می‌خواند تا چیزی کهنه نماند.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});