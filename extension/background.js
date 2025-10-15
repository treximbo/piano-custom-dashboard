// Watches composer requests and grabs the Authorization header
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    try {
      // Only capture from real GET requests (ignore OPTIONS preflight and others)
      const method = (details.method || '').toUpperCase();
      if (method !== 'GET') { return; }
      const hdr = details.requestHeaders || [];
      const auth = hdr.find(h => h && h.name && h.name.toLowerCase() === 'authorization');
      if (!auth || !auth.value) { return; }
      const token = auth.value.trim().replace(/^Bearer\s+/i, '');
      if (!token) { return; }

      // Save token locally
      chrome.storage.local.set({ composer_bearer: token, composer_bearer_captured_at: Date.now() }, () => {});

      // Notify any open dashboard tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (!t.id) return;
          chrome.tabs.sendMessage(t.id, { type: 'PIANO_COMPOSER_BEARER', token }, () => { /* ignore */ });
        });
      });
    } catch (e) {
      // ignore
    }
  },
  {
    urls: [
      // Only target the conversion endpoint; the method filter above avoids OPTIONS
      "https://prod-ai-report-api.piano.io/report/composer/conversion*",
      "https://dashboard.piano.io/publisher/composer/edit/*/conversionReport*"
    ]
  },
  ["requestHeaders", "extraHeaders"]
);

// Respond to token requests from content script to avoid invalidated context issues
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg && msg.type === 'GET_TOKEN') {
      chrome.storage.local.get('composer_bearer', (res) => {
        sendResponse({ token: res && res.composer_bearer });
      });
      return true; // async response
    }
  } catch (e) {
    // ignore
  }
});
