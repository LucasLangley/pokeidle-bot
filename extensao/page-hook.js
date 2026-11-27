// Executado no mundo MAIN de https://pokeidle.io/app em document_start.
// Envolve apenas o WebSocket do pokeidle.io para espelhar os quadros para o bot local
// e permitir que o bot envie comandos pela MESMA sessão única da aba.
(() => {
  if (window.__PK_PONTE_HOOK__) return;
  window.__PK_PONTE_HOOK__ = true;

  const NS = '__PK_PONTE__';
  const OrigWS = window.WebSocket;
  let wsJogo = null;
  let enviandoDoBot = false;

  const avisar = (tipo, payload = {}) => {
    try { window.postMessage({ ns: NS, dir: 'page->ext', tipo, ...payload }, window.location.origin); } catch {}
  };

  function ehWsDoJogo(url) {
    try {
      const u = new URL(String(url), window.location.href);
      return /^wss?:$/i.test(u.protocol) && /(^|\.)pokeidle\.io$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  function WrappedWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    if (ehWsDoJogo(url)) {
      wsJogo = ws;
      const origSend = ws.send.bind(ws);
      ws.send = function patchedSend(data) {
        if (!enviandoDoBot && typeof data === 'string') {
          try {
            const obj = JSON.parse(data);
            // Ignora pings rotineiros do cliente
            if (obj && obj.t && obj.t !== 'ping') avisar('ws.out', { msg: obj });
          } catch {}
        }
        return origSend(data);
      };

      ws.addEventListener('open', () => {
        avisar('ws.open', { url: String(url) });
      });
      ws.addEventListener('message', (ev) => {
        if (typeof ev.data === 'string') {
          avisar('ws.in', { raw: ev.data });
        }
      });
      ws.addEventListener('close', (ev) => {
        if (wsJogo === ws) wsJogo = null;
        avisar('ws.close', { code: ev.code, reason: ev.reason });
      });
    }
    return ws;
  }

  WrappedWebSocket.prototype = OrigWS.prototype;
  Object.setPrototypeOf(WrappedWebSocket, OrigWS);
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    try { WrappedWebSocket[k] = OrigWS[k]; } catch {}
  }
  window.WebSocket = WrappedWebSocket;

  // Recebe comandos do bot local (via content.js) para enviar no mesmo WebSocket da aba
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const d = ev.data;
    if (!d || d.ns !== NS || d.dir !== 'ext->page') return;
    if (d.tipo === 'ws.enviar' && d.msg && wsJogo && wsJogo.readyState === OrigWS.OPEN) {
      try {
        enviandoDoBot = true;
        wsJogo.send(JSON.stringify(d.msg));
      } catch {} finally {
        enviandoDoBot = false;
      }
    } else if (d.tipo === 'ws.status') {
      if (wsJogo && wsJogo.readyState === OrigWS.OPEN) avisar('ws.open', {});
    }
  });
})();
