#!/usr/bin/env node
// Activa el control MCP en vivo dentro del WebView2 de la app de depuración y
// recarga. Requiere lanzar la app con
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
const port = Number(process.argv[2] ?? '9222');

async function target() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await response.json();
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // todavía no levantó
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('no apareció un target de WebView2 con remote debugging');
}

function command(socket, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 15_000);
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(message);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const page = await target();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP no conectó')), {
      once: true,
    });
  });
  const enabled = await command(
    socket,
    1,
    'Runtime.evaluate',
    {
      expression:
        "localStorage.setItem('olyvia.mcp.live','1'); localStorage.getItem('olyvia.mcp.live')",
      returnByValue: true,
    },
  );
  const value = enabled.result?.result?.value;
  if (value !== '1') throw new Error(`localStorage no quedó activo: ${value}`);
  await command(socket, 2, 'Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const clicked = await command(
    socket,
    3,
    'Runtime.evaluate',
    {
      expression:
        "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent && x.textContent.includes('Director IA'));if(!b)return 'sin botón';b.click();return 'clicked';})()",
      returnByValue: true,
    },
  );
  const clickResult = clicked.result?.result?.value;
  if (clickResult !== 'clicked') throw new Error(`no se pudo entrar: ${clickResult}`);
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  console.log(
    JSON.stringify({ ok: true, target: page.url, liveEnabled: value, entered: clickResult }),
  );
  socket.close();
} catch (error) {
  console.error(`enable-live-cdp falló: ${error.message}`);
  process.exitCode = 1;
}
