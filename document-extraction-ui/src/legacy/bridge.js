// Preserve the original page implementation and state, while the React shell owns navigation.
const supportedShellPages = new Set(['overview', 'scenes', 'business', 'batch', 'sceneDetail', 'services', 'develop', 'tools', 'evaluation', 'release', 'review', 'resources', 'operations']);
const originalPageRender = render;
const originalPageGo = go;
let shellNavigating = false;
function notifyShell(page) {
  parent.postMessage({ source: 'document-platform-legacy', type: 'navigate', page }, '*');
}
render = function () {
  if (s.page === 'business') { notifyShell('business'); return; }
  originalPageRender();
  if (!shellNavigating) notifyShell(s.page);
};
go = function (page) {
  if (!supportedShellPages.has(page)) return;
  if (page === 'business') { closeModal(); notifyShell(page); return; }
  originalPageGo(page);
};
window.addEventListener('message', function (event) {
  if (event.source !== parent || event.data?.source !== 'document-platform-shell') return;
  if (event.data.type === 'theme') {
    const mode = event.data.mode === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
  }
  if (event.data.type === 'navigate' && supportedShellPages.has(event.data.page) && event.data.page !== 'business') {
    closeModal();
    shellNavigating = true;
    try { originalPageGo(event.data.page); } finally { shellNavigating = false; }
  }
});
// The initial hidden render must not navigate the shell away from the extraction page.
if (s.page === 'business' || !supportedShellPages.has(s.page)) s.page = 'scenes';
shellNavigating = true;
setTimeout(() => { shellNavigating = false; }, 0);
