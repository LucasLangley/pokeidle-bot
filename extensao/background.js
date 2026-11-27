// Service Worker (MV3) — mantém a ponte WebSocket local com ws://127.0.0.1:8787/ponte
// fora da CSP do site pokeidle.io e faz proxy das chamadas locais de estado/config para o HUD.
const BASE_HTTP = 'http://127.0.0.1:8787';
const BASE_WS = 'ws://127.0.0.1:8787/ponte';

let portaAtiva = null;
let wsBot = null;
let reconectarTimer = null;
let pingTimer = null;
let filaParaBot = [];
let wsJogoAberto = false;

function enviarParaTab(msg) {
  if (!portaAtiva) return;
  try { portaAtiva.postMessage(msg); } catch {}
}

function enviarParaBot(obj) {
  const txt = JSON.stringify(obj);
  if (wsBot && wsBot.readyState === WebSocket.OPEN) {
    try { wsBot.send(txt); return; } catch {}
  }
  // Guarda mensagens recentes caso o bot esteja reconectando (limita a 60)
  if (filaParaBot.length < 60) filaParaBot.push(txt);
}

function desconectarBot() {
  clearTimeout(reconectarTimer); reconectarTimer = null;
  clearInterval(pingTimer); pingTimer = null;
  filaParaBot = [];
  if (wsBot) {
    const s = wsBot; wsBot = null;
    try { s.close(1000, 'aba fechada'); } catch {}
  }
}

function conectarBot() {
  if (!portaAtiva) return;
  if (wsBot && (wsBot.readyState === WebSocket.OPEN || wsBot.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(reconectarTimer); reconectarTimer = null;
  let ws;
  try {
    ws = new WebSocket(BASE_WS);
  } catch {
    agendarReconexao();
    return;
  }
  wsBot = ws;

  ws.onopen = () => {
    enviarParaTab({ tipo: 'bot.status', conectado: true });
    if (wsJogoAberto) enviarParaBot({ t: 'ponte.ws.open' });
    while (filaParaBot.length && ws.readyState === WebSocket.OPEN) {
      try { ws.send(filaParaBot.shift()); } catch { break; }
    }
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send('{"t":"ponte.ping"}'); } catch {}
      }
    }, 15_000);
  };

  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'ponte.enviar' && m.msg) {
      enviarParaTab({ tipo: 'ws.enviar', msg: m.msg });
    } else if (m.t === 'ponte.pronto') {
      enviarParaTab({ tipo: 'bot.pronto', nick: m.nick });
    }
  };

  ws.onclose = () => {
    clearInterval(pingTimer); pingTimer = null;
    if (wsBot === ws) wsBot = null;
    enviarParaTab({ tipo: 'bot.status', conectado: false });
    if (portaAtiva) agendarReconexao();
  };

  ws.onerror = () => {
    try { ws.close(); } catch {}
  };
}

function agendarReconexao() {
  if (!portaAtiva || reconectarTimer) return;
  reconectarTimer = setTimeout(() => {
    reconectarTimer = null;
    conectarBot();
  }, 2500);
}

// Conexão persistente com a aba ativa do pokeidle.io/app
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pokeidle-ponte') return;
  if (portaAtiva && portaAtiva !== port) {
    try { portaAtiva.disconnect(); } catch {}
  }
  portaAtiva = port;
  wsJogoAberto = false;
  conectarBot();

  port.onMessage.addListener((m) => {
    if (!m || typeof m !== 'object') return;
    if (m.tipo === 'ws.open') {
      wsJogoAberto = true;
      enviarParaBot({ t: 'ponte.ws.open' });
    } else if (m.tipo === 'ws.close') {
      wsJogoAberto = false;
      enviarParaBot({ t: 'ponte.ws.close', code: m.code });
    } else if (m.tipo === 'ws.in') {
      enviarParaBot({ t: 'ponte.in', raw: m.raw });
    } else if (m.tipo === 'ws.out') {
      enviarParaBot({ t: 'ponte.out', msg: m.msg });
    } else if (m.tipo === 'keepalive') {
      if (!wsBot || wsBot.readyState !== WebSocket.OPEN) conectarBot();
    }
  });

  port.onDisconnect.addListener(() => {
    if (portaAtiva === port) {
      portaAtiva = null;
      wsJogoAberto = false;
      desconectarBot();
    }
  });
});

// Proxy seguro das requisições HTTP do HUD para o bot local (127.0.0.1:8787)
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (!req || req.tipo !== 'api') return false;
  const rota = String(req.rota || '');
  if (!/^\/(estado|bot\/config|bot\/pausa|jogo\/acao)$/.test(rota)) {
    sendResponse({ ok: false, erro: 'rota não permitida' });
    return false;
  }
  const init = {
    method: req.metodo === 'POST' ? 'POST' : 'GET',
    headers: req.metodo === 'POST' ? { 'content-type': 'application/json', 'x-painel': '1' } : {},
  };
  if (init.method === 'POST' && req.corpo !== undefined) init.body = JSON.stringify(req.corpo);

  fetch(BASE_HTTP + rota, init)
    .then(async (r) => {
      const dados = await r.json().catch(() => null);
      sendResponse({ ok: r.ok, status: r.status, dados });
    })
    .catch((e) => sendResponse({ ok: false, erro: e.message || 'bot offline' }));
  return true;
});
