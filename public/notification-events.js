/* Notification clicks use existing app clients; no background push subscription is installed. */
self.addEventListener('notificationclick', event => {
  const data = event.notification.data;
  if (data?.type !== 'codex-task') return;
  event.notification.close();
  event.waitUntil((async () => {
    const target = { deviceId: typeof data.deviceId === 'string' ? data.deviceId : '', threadId: typeof data.threadId === 'string' ? data.threadId : '' };
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => new URL(item.url).origin === self.location.origin);
    if (client) { await client.focus(); client.postMessage({ type: 'codex-notification-open', target }); }
    else { const url = new URL('/', self.location.origin); url.searchParams.set('notificationDevice', target.deviceId); url.searchParams.set('notificationThread', target.threadId); await self.clients.openWindow(url.href); }
  })());
});
