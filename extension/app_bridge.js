// Forwards messages between extension and our web page
// Extension -> Page: when background finds token or sends it, forward it to our dashboard page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'PIANO_COMPOSER_BEARER' && msg.token) {
    window.postMessage({ type: 'PIANO_COMPOSER_BEARER', token: msg.token }, window.location.origin);
  }
});

// Page -> Extension: if the page asks for the stored token, request it via background (avoids invalidated content context)
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data || {};
  if (data && data.type === 'REQUEST_PIANO_TOKEN') {
    try {
      chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (resp) => {
        const tok = resp && resp.token;
        if (tok) window.postMessage({ type: 'PIANO_COMPOSER_BEARER', token: tok }, window.location.origin);
      });
    } catch (e) {
      // ignore
    }
  }
});
