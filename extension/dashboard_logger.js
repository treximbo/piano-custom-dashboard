// Injects an alert with the current captured token when the dashboard loads,
// and listens for updates from the background service worker.
(function(){
  const say = (msg) => {
    try { console.log('[PianoExt][Dashboard]', msg); } catch {}
  };
  try {
    chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (resp) => {
      if (resp && resp.token) {
        const frag = resp.token.length > 50 ? resp.token.slice(-50) : resp.token;
        say('Composer token (last 50 chars): ' + frag);
      } else {
        say('No composer token found yet. Open a Conversion Report page to trigger the API.');
      }
    });
  } catch {}
  // Also listen for token updates during the session
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PIANO_COMPOSER_BEARER' && msg.token) {
      const frag = msg.token.length > 50 ? msg.token.slice(-50) : msg.token;
      say('New composer token captured (last 50 chars): ' + frag);
    }
  });
})();
