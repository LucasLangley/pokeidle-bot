// Content Script (ISOLATED) em https://pokeidle.io/app
// 1) Conecta imediatamente ao background.js (que avisa o bot.mjs para ceder a sessão antes do 4001)
// 2) Faz ponte entre page-hook.js (MAIN) e background.js
// 3) Renderiza o HUD flutuante do bot (métricas ao vivo, pausa seletiva e ajustes sem reiniciar)
(() => {
  const NS = '__PK_PONTE__';
  let porta = null;
  let botConectado = false;
  let painelAberto = false;
  let ultimoEstado = null;
  let cfgAtual = null;

  function conectarPorta() {
    try {
      porta = chrome.runtime.connect({ name: 'pokeidle-ponte' });
      porta.onMessage.addListener((m) => {
        if (!m) return;
        if (m.tipo === 'ws.enviar') {
          window.postMessage({ ns: NS, dir: 'ext->page', tipo: 'ws.enviar', msg: m.msg }, window.location.origin);
        } else if (m.tipo === 'bot.status') {
          botConectado = !!m.conectado;
          atualizarPilula();
        } else if (m.tipo === 'bot.pronto') {
          botConectado = true;
          window.postMessage({ ns: NS, dir: 'ext->page', tipo: 'ws.status' }, window.location.origin);
          atualizarPilula();
        }
      });
      porta.onDisconnect.addListener(() => {
        porta = null;
        botConectado = false;
        atualizarPilula();
        setTimeout(conectarPorta, 1500);
      });
    } catch {
      setTimeout(conectarPorta, 2000);
    }
  }

  // Abre a ponte em document_start o mais rápido possível!
  conectarPorta();

  // Keepalive leve para manter o service worker acordado enquanto a aba estiver aberta
  setInterval(() => {
    try { porta?.postMessage({ tipo: 'keepalive' }); } catch {}
  }, 20_000);

  // Escuta mensagens vindas do page-hook.js (MAIN)
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const d = ev.data;
    if (!d || d.ns !== NS || d.dir !== 'page->ext') return;
    try {
      porta?.postMessage({ tipo: d.tipo, raw: d.raw, msg: d.msg, code: d.code });
    } catch {}
  });

  // ---- Chamadas API ao bot local via background.js ----
  function api(rota, metodo = 'GET', corpo) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ tipo: 'api', rota, metodo, corpo }, (resp) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, erro: chrome.runtime.lastError.message });
          resolve(resp || { ok: false, erro: 'sem resposta' });
        });
      } catch (e) {
        resolve({ ok: false, erro: e.message });
      }
    });
  }

  const fmtC = (v) => {
    if (v == null || Number.isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi';
    if (a >= 1e6) return (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (a >= 1e4) return (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return Math.round(v).toLocaleString('pt-BR');
  };

  // ---- HUD Flutuante discreto sobre o pokeidle.io/app ----
  let raiz = null;
  function montarHud() {
    if (raiz || !document.body) return;
    raiz = document.createElement('div');
    raiz.id = 'pkbot-hud';
    raiz.innerHTML = `
      <button type="button" class="pkb-pill" id="pkb-pill" title="Abrir painel rápido do PokeIdle Bot">
        <span class="pkb-dot" id="pkb-dot"></span>
        <strong id="pkb-pill-st">Bot</strong>
        <span class="pkb-sep">·</span>
        <span id="pkb-pill-xp">— XP/h</span>
        <span class="pkb-badge" id="pkb-pill-man" hidden>Manual</span>
      </button>

      <div class="pkb-drawer" id="pkb-drawer" hidden>
        <div class="pkb-head">
          <div>
            <strong>PokeIdle Bot</strong>
            <div class="pkb-sub" id="pkb-modo-txt">Conectando ao bot local…</div>
          </div>
          <div style="display:flex;gap:6px">
            <a class="pkb-btn" href="http://localhost:8787" target="_blank" rel="noopener">Painel completo ↗</a>
            <button type="button" class="pkb-btn" id="pkb-fechar">✕</button>
          </div>
        </div>

        <div class="pkb-kpis">
          <div class="pkb-kpi"><span>XP / h</span><b id="pkb-xph">—</b></div>
          <div class="pkb-kpi"><span>Ouro / h</span><b id="pkb-ouroh">—</b></div>
          <div class="pkb-kpi"><span>Abates / h</span><b id="pkb-abh">—</b></div>
          <div class="pkb-kpi"><span>Sniper lucro</span><b id="pkb-sn">—</b></div>
        </div>

        <div class="pkb-sec">
          <div class="pkb-sec-h">
            <span>Controle & Pausa Seletiva</span>
            <button type="button" class="pkb-btn warn" id="pkb-btn-pausa">Pausar bot</button>
          </div>
          <div class="pkb-manual" id="pkb-manual-box"></div>
        </div>

        <div class="pkb-sec">
          <div class="pkb-sec-h">
            <span>Configurações ao vivo (sem reiniciar)</span>
            <span style="display:flex;gap:4px">
              <button type="button" class="pkb-btn ok" id="pkb-cfg-ideal" title="Aplicar perfil ideal de progressão">⭐ Ideal</button>
              <button type="button" class="pkb-btn" id="pkb-cfg-reload">↻</button>
            </span>
          </div>
          <div class="pkb-form" id="pkb-cfg-form">
            <label class="pkb-chk"><input type="checkbox" name="somenteLer"> Modo Só Leitura (bot não envia nada)</label>
            <label class="pkb-row"><span>Captura</span>
              <select name="modoCaptura">
                <option value="vip">VIP (Auto-Catch servidor)</option>
                <option value="sempre">Sempre</option>
                <option value="time">Time</option>
                <option value="rajada">Rajada</option>
                <option value="nao">Desligada</option>
              </select>
            </label>
            <label class="pkb-row"><span>Margem nível hunt</span><input type="number" name="margemNivel" min="0" max="100"></label>
            <label class="pkb-row"><span>Hunt acima do Pokémon</span><input type="number" name="huntAcimaPokemon" min="0" max="200"></label>
            <label class="pkb-row"><span>Poção abaixo de (%)</span><input type="number" name="hpLimiarPct" min="10" max="95"></label>
            <div class="pkb-checks">
              <label class="pkb-chk"><input type="checkbox" name="gerirEquipe"> Gerir equipe</label>
              <label class="pkb-chk"><input type="checkbox" name="evoluir"> Evoluir</label>
              <label class="pkb-chk"><input type="checkbox" name="autoVenda"> Auto Venda</label>
              <label class="pkb-chk"><input type="checkbox" name="prey"> Prey grátis</label>
              <label class="pkb-chk"><input type="checkbox" name="pvp"> PvP auto</label>
              <label class="pkb-chk"><input type="checkbox" name="sacrificio"> Sacrifício</label>
              <label class="pkb-chk"><input type="checkbox" name="bosses"> Bosses</label>
              <label class="pkb-chk"><input type="checkbox" name="raid"> Raid</label>
            </div>
            <div class="pkb-cfg-foot">
              <label class="pkb-chk"><input type="checkbox" id="pkb-salvar-env" checked> Salvar no .env</label>
              <button type="button" class="pkb-btn pri" id="pkb-cfg-salvar">Aplicar agora</button>
            </div>
            <div class="pkb-msg" id="pkb-msg"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(raiz);

    raiz.querySelector('#pkb-pill').onclick = () => {
      painelAberto = !painelAberto;
      raiz.querySelector('#pkb-drawer').hidden = !painelAberto;
      if (painelAberto) { atualizarEstado(); carregarConfig(); }
    };
    raiz.querySelector('#pkb-fechar').onclick = () => {
      painelAberto = false;
      raiz.querySelector('#pkb-drawer').hidden = true;
    };
    raiz.querySelector('#pkb-btn-pausa').onclick = async () => {
      const quer = !ultimoEstado?.pausado;
      const r = await api('/bot/pausa', 'POST', { pausar: quer });
      mostrarMsg(r.ok ? (quer ? 'Bot pausado (só observando)' : 'Bot religado!') : (r.erro || 'Falha'), !r.ok);
      atualizarEstado();
    };
    raiz.querySelector('#pkb-cfg-reload').onclick = carregarConfig;
    raiz.querySelector('#pkb-cfg-salvar').onclick = salvarConfig;
    raiz.querySelector('#pkb-cfg-ideal').onclick = async () => {
      const ideal = {
        somenteLer: false, modoCaptura: 'vip', margemNivel: 0, huntAcimaPokemon: 20, hpLimiar: 0.6,
        gerirEquipe: true, equipeMax: 5, timeForte: false, evoluir: true,
        autoVenda: true, colecaoNotaMin: 3.5, prey: true, pvp: true,
        sacrificio: true, bosses: true, raid: true, topCatch: false,
        salvarEnv: !!raiz.querySelector('#pkb-salvar-env').checked,
      };
      const r = await api('/bot/config', 'POST', ideal);
      mostrarMsg(r.ok && r.dados?.ok ? '⭐ Padrão ideal aplicado!' : (r.dados?.erro || r.erro || 'Erro'), !(r.ok && r.dados?.ok));
      carregarConfig();
      atualizarEstado();
    };

    posicionarAoLadoDaHunt();
    window.addEventListener('resize', posicionarAoLadoDaHunt);
    setInterval(posicionarAoLadoDaHunt, 1200);

    atualizarPilula();
    atualizarEstado();
  }

  // Encontra o badge "Nome · nível NNN" (ou "Centro Pokémon") no topo esquerdo do mapa e ancora nossa pílula à direita dele
  let ultPos = '';
  function posicionarAoLadoDaHunt() {
    if (!raiz) return;
    let melhor = null, menorArea = Infinity;
    const todos = document.querySelectorAll('div, span, button, p, header');
    for (const el of todos) {
      if (raiz.contains(el)) continue;
      if (el.children.length > 3) continue;
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 48) continue;
      if (!/(nível\s+\d+|centro\s+pok[eé]mon)/i.test(txt)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.width > 380 || r.height < 18 || r.height > 62) continue;
      if (r.top < 40 || r.top > 240 || r.left < 160 || r.left > window.innerWidth * 0.6) continue;
      // Se o texto estiver num span interno sem fundo, sobe 1 nível para pegar a caixa do badge
      let alvo = el;
      const pai = el.parentElement;
      if (pai && !raiz.contains(pai)) {
        const pr = pai.getBoundingClientRect();
        if (pr.width <= 380 && pr.height <= 62 && pr.width >= r.width && pr.height >= r.height && (pai.textContent || '').trim() === txt) {
          alvo = pai;
        }
      }
      const ar = alvo.getBoundingClientRect();
      const area = ar.width * ar.height;
      if (area < menorArea) { menorArea = area; melhor = ar; }
    }
    let left = 495, top = 90;
    if (melhor) {
      const pillH = raiz.querySelector('#pkb-pill')?.offsetHeight || 34;
      left = Math.round(melhor.right + 10);
      top = Math.round(melhor.top + (melhor.height - pillH) / 2);
      // Evita sair pela direita da tela
      const maxLeft = Math.max(180, window.innerWidth - 260);
      if (left > maxLeft) left = maxLeft;
    }
    const chave = `${left}:${top}`;
    if (chave !== ultPos) {
      ultPos = chave;
      raiz.style.left = `${left}px`;
      raiz.style.top = `${top}px`;
      raiz.style.bottom = 'auto';
    }
  }

  function mostrarMsg(txt, erro = false) {
    const el = raiz?.querySelector('#pkb-msg');
    if (!el) return;
    el.textContent = txt;
    el.className = 'pkb-msg ' + (erro ? 'err' : 'ok');
    setTimeout(() => { if (el.textContent === txt) el.textContent = ''; }, 4000);
  }

  function atualizarPilula() {
    if (!raiz) return;
    const dot = raiz.querySelector('#pkb-dot');
    const st = raiz.querySelector('#pkb-pill-st');
    const modoTxt = raiz.querySelector('#pkb-modo-txt');
    if (!botConectado) {
      dot.className = 'pkb-dot off';
      st.textContent = 'Bot offline';
      if (modoTxt) modoTxt.textContent = 'bot.mjs não respondeu em 127.0.0.1:8787';
      return;
    }
    const s = ultimoEstado;
    if (s?.pausado) {
      dot.className = 'pkb-dot warn';
      st.textContent = 'Bot pausado';
      if (modoTxt) modoTxt.textContent = 'Sessão compartilhada · bot só observando';
    } else if (s?.somenteLer) {
      dot.className = 'pkb-dot warn';
      st.textContent = 'Só leitura';
      if (modoTxt) modoTxt.textContent = 'Sessão compartilhada · modo somente leitura';
    } else {
      dot.className = 'pkb-dot on';
      st.textContent = 'Bot ativo';
      if (modoTxt) modoTxt.textContent = s?.modoConexao === 'navegador'
        ? '🟢 Sessão única compartilhada com esta aba'
        : 'Conectando ponte com a aba…';
    }
  }

  async function atualizarEstado() {
    const r = await api('/estado', 'GET');
    if (!r.ok || !r.dados) {
      botConectado = false;
      atualizarPilula();
      return;
    }
    botConectado = true;
    const s = r.dados;
    ultimoEstado = s;
    atualizarPilula();
    if (!raiz) return;

    const cedo = (s.minutos ?? 0) < 5;
    raiz.querySelector('#pkb-pill-xp').textContent = cedo ? 'medindo…' : `${fmtC(s.xph)} XP/h`;
    raiz.querySelector('#pkb-xph').textContent = cedo ? 'medindo…' : fmtC(s.xph);
    raiz.querySelector('#pkb-ouroh').textContent = cedo ? 'medindo…' : `${s.ouroh > 0 ? '+' : ''}${fmtC(s.ouroh)}`;
    raiz.querySelector('#pkb-abh').textContent = cedo ? 'medindo…' : fmtC(s.abatesh);
    const vendas = (s.sniperPk?.compras ?? []).filter((x) => x.estado === 'vendido');
    const lucro = vendas.reduce((t, x) => t + (x.lucro ?? 0), 0);
    raiz.querySelector('#pkb-sn').textContent = vendas.length ? `${lucro > 0 ? '+' : ''}${lucro} 💎` : '—';

    const bp = raiz.querySelector('#pkb-btn-pausa');
    bp.textContent = s.pausado ? 'Ligar bot' : 'Pausar bot';
    bp.className = s.pausado ? 'pkb-btn ok' : 'pkb-btn warn';

    const man = s.manual ?? {};
    const chips = [];
    if (man.hunt) chips.push(`<span class="pkb-chip">Hunt fixa <button data-lib="hunt">liberar</button></span>`);
    if (man.equipeMin > 0) chips.push(`<span class="pkb-chip">Equipe (${man.equipeMin}m) <button data-lib="equipe">liberar</button></span>`);
    if (man.centroMin > 0) chips.push(`<span class="pkb-chip">Centro (${man.centroMin}m) <button data-lib="centro">liberar</button></span>`);
    if (man.autoMin > 0) chips.push(`<span class="pkb-chip">Automações (${man.autoMin}m) <button data-lib="auto">liberar</button></span>`);

    raiz.querySelector('#pkb-pill-man').hidden = !chips.length;
    const mbox = raiz.querySelector('#pkb-manual-box');
    mbox.innerHTML = chips.length
      ? chips.join('') + `<button type="button" class="pkb-btn" data-lib="tudo" style="margin-left:auto">Devolver tudo</button>`
      : '<span class="pkb-sub">Nenhuma trava manual ativa — quando você trocar hunt, equipe ou automações no jogo, o bot pausa automaticamente aquela parte.</span>';
    mbox.querySelectorAll('[data-lib]').forEach((b) => {
      b.onclick = async () => {
        const res = await api('/jogo/acao', 'POST', { acao: 'manual.liberar', parte: b.dataset.lib });
        mostrarMsg(res.ok ? (res.dados?.msg || 'Devolvido ao bot') : (res.erro || 'Erro'), !res.ok);
        atualizarEstado();
      };
    });
  }

  async function carregarConfig() {
    const r = await api('/bot/config', 'GET');
    if (!r.ok || !r.dados || !raiz) return;
    cfgAtual = r.dados;
    const f = raiz.querySelector('#pkb-cfg-form');
    for (const [k, v] of Object.entries(cfgAtual)) {
      const inp = f.querySelector(`[name="${k}"]`);
      if (!inp) continue;
      if (inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = v;
    }
    const hp = f.querySelector('[name="hpLimiarPct"]');
    if (hp && cfgAtual.hpLimiar != null) hp.value = Math.round(cfgAtual.hpLimiar * 100);
  }

  async function salvarConfig() {
    if (!raiz) return;
    const f = raiz.querySelector('#pkb-cfg-form');
    const body = { salvarEnv: !!raiz.querySelector('#pkb-salvar-env').checked };
    for (const k of ['somenteLer', 'gerirEquipe', 'evoluir', 'autoVenda', 'prey', 'pvp', 'sacrificio', 'bosses', 'raid']) {
      const inp = f.querySelector(`[name="${k}"]`);
      if (inp) body[k] = inp.checked;
    }
    body.modoCaptura = f.querySelector('[name="modoCaptura"]').value;
    body.margemNivel = Number(f.querySelector('[name="margemNivel"]').value);
    body.huntAcimaPokemon = Number(f.querySelector('[name="huntAcimaPokemon"]').value);
    body.hpLimiar = Math.round(Number(f.querySelector('[name="hpLimiarPct"]').value)) / 100;

    const r = await api('/bot/config', 'POST', body);
    if (r.ok && r.dados?.ok) {
      mostrarMsg(r.dados.mudancas?.length ? `Aplicado: ${r.dados.mudancas.length} ajuste(s)` : 'Sem alterações');
      atualizarEstado();
    } else {
      mostrarMsg(r.dados?.erro || r.erro || 'Erro ao salvar', true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarHud);
  else montarHud();
  setInterval(() => { if (raiz) atualizarEstado(); }, 4000);
})();
