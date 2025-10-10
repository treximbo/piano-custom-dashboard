// Watches composer requests and grabs the Authorization header
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    try {
      const hdr = details.requestHeaders || [];
      const auth = hdr.find(h => h && h.name && h.name.toLowerCase() === 'authorization');
      if (!auth || !auth.value) {
        console.log('[PianoExt] No Authorization header on', details.url);
        return;
      }
      const token = auth.value.trim().replace(/^Bearer\s+/i, '');
      if (!token) {
        console.log('[PianoExt] Authorization header present but no token');
        return;
      }

      // Save token locally
      chrome.storage.local.set({ composer_bearer: token }, () => {
        console.log('[PianoExt] Stored composer bearer');
      });

      // Notify any open dashboard tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (!t.id) return;
          chrome.tabs.sendMessage(t.id, { type: 'PIANO_COMPOSER_BEARER', token }, () => {
            const err = chrome.runtime.lastError;
            if (err) {
              console.log('[PianoExt] sendMessage error (tab likely not our app)', err.message);
            } else {
              console.log('[PianoExt] Notified tab', t.id);
            }
          });
        });
      });
    } catch (e) {
      // ignore
    }
  },
  {
    urls: [
      "https://prod-ai-report-api.piano.io/report/composer/conversion*",
      "https://dashboard.piano.io/publisher/composer/edit/*/conversionReport*"
    ]
  },
  ["requestHeaders", "extraHeaders"]
);
