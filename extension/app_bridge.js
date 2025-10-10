// Forwards messages between extension and our web page
console.log('[PianoExt] Content script loaded');

// Extension -> Page: when background finds token or sends it, forward it to our dashboard page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'PIANO_COMPOSER_BEARER' && msg.token) {
    console.log('[PianoExt] Forwarding token to page');
    window.postMessage({ type: 'PIANO_COMPOSER_BEARER', token: msg.token }, window.location.origin);
  }
});

// Page -> Extension: if the page asks for the stored token, read it and send it to the page
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data || {};
  if (data && data.type === 'REQUEST_PIANO_TOKEN') {
    chrome.storage.local.get('composer_bearer', (res) => {
      const token = res && res.composer_bearer;
      if (token) {
        console.log('[PianoExt] Replying to page with stored token');
        window.postMessage({ type: 'PIANO_COMPOSER_BEARER', token }, window.location.origin);
      }
    });
  }
});
