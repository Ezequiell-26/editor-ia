/**
 * Service worker: opens the side panel from the toolbar and keeps a small
 * progress badge. All queue state lives in the side panel, which is the only
 * surface that can show the user what is happening.
 */

const PANEL_BEHAVIOR = { openPanelOnActionClick: true };

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior(PANEL_BEHAVIOR).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior(PANEL_BEHAVIOR).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.setPanelBehavior(PANEL_BEHAVIOR);
    if (tab?.id !== undefined) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch {
    // The panel can also be opened from Chrome's side-panel menu.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FLOWQ_BADGE') return false;
  (async () => {
    const text = String(message.text ?? '').slice(0, 4);
    try {
      await chrome.action.setBadgeBackgroundColor({ color: message.color ?? '#2f7df6' });
      await chrome.action.setBadgeText({ text });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  })();
  return true;
});
