const MENU_ID = 'editor-ia-download';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Descargar con Editor IA',
      contexts: ['page', 'link', 'image', 'video', 'audio'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  let url = info.pageUrl || tab?.url || '';
  let directImage = false;
  if (info.mediaType === 'image' && info.srcUrl && /^https?:/i.test(info.srcUrl)) {
    url = info.srcUrl;
    directImage = true;
  } else if (info.linkUrl && /^https?:/i.test(info.linkUrl)) {
    url = info.linkUrl;
  }
  if (!url) return;
  const query = `url=${encodeURIComponent(url)}${directImage ? '&directImage=1' : ''}`;
  chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?${query}`),
    type: 'popup',
    width: 430,
    height: 680,
  });
});
