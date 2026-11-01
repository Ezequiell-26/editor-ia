const open = document.getElementById('open');
const flow = document.getElementById('flow');
const status = document.getElementById('status');

open.addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel.html') });
    window.close();
  } catch (error) {
    status.textContent = `No se pudo abrir el panel: ${error.message}`;
  }
});

flow.addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: 'https://flow.google.com/' });
    window.close();
  } catch (error) {
    status.textContent = `No se pudo abrir Flow: ${error.message}`;
  }
});
