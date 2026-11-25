// PokeIdle farm bot — cliente WebSocket próprio (Node 22+, sem dependências).
//
// O jogo simula a caça no servidor: o cliente só escolhe a área (hunt.select),
// liga automações (auto.set) e, opcionalmente, lança bolas nos selvagens caídos
// (ball.throw). Este bot faz exatamente isso, mais a gestão em volta:
//   - escolhe a melhor hunt liberada para o nível (e recua se o time morrer muito)
//   - repõe poções, revives e Poke Balls na loja NPC (shop.buy) com teto de gasto
//   - cura no Centro quando o time cai
//   - lança bola nos caídos (captura manual, a mesma do botão da UI)
//   - resgata o passe diário
// NÃO mexe em Mercado, Orbs, diamantes, venda de pokemon nem nada que envolva
// dinheiro real.
//
// Uma conexão por conta: abrir o jogo no navegador derruba o bot (código 4001)
// e o bot então para, em vez de brigar pela sessão.

import { readFileSync, existsSync, appendFileSync, writeFileSync, statSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ---------- config ----------
function carregarEnv() {
  const p = join(AQUI, '.env');
  if (!existsSync(p)) return;
  for (const linha of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnv();
const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => Number(env(k, d));
const bool = (k, d) => /^(1|true|sim|yes)$/i.test(String(env(k, d)));

const CFG = {
  nick: env('POKEIDLE_NICK'),
  token: env('POKEIDLE_TOKEN'),
  dispositivo: env('POKEIDLE_DISPOSITIVO') || randomUUID(),
  host: env('POKEIDLE_HOST', 'pokeidle.io'),
  somenteLer: bool('SOMENTE_LER', '0'),     // 1 = conecta, loga estado e decisões, não envia ações
  // vip (padrão): só o Auto-Catch do servidor, que é benefício VIP; o bot não lança bola sozinho.
  // sempre | time | rajada: o bot lança (uma tentativa por corpo vale; o resto o servidor ignora). 0: nunca.
  modoCaptura: (() => { const v = String(env('CAPTURAR', 'vip')).toLowerCase(); return /^(0|nao|não|false|off)$/.test(v) ? 'nao' : ['rajada', 'sempre', 'time'].includes(v) ? v : 'vip'; })(),
  rajadaMs: num('RAJADA_MS', 700),       // modo rajada: intervalo entre bolas no mesmo caído
  ouroReservaBolas: num('OURO_RESERVA_BOLAS', 3000), // abaixo disso, só uma bola por caído
  bolaReserva: num('BOLA_RESERVA', 20),      // não lança abaixo disso
  minPocoes: num('MIN_POCOES', 60),
  minRevives: num('MIN_REVIVES', 10),
  minBolas: num('MIN_BOLAS', 100),
  gastoMaxFracao: num('GASTO_MAX_FRACAO', 0.4), // por compra, fração do ouro em caixa
  margemNivel: num('MARGEM_NIVEL', 0),
  huntAcimaPokemon: num('HUNT_ACIMA_POKEMON', 20), // hunt no máximo N níveis acima do pokemon ativo (com boost o treinador dispara na frente)        // hunt alvo = maior nivel <= (nivelTreinador - margem)
  // auto (padrão): as regiões principais conforme abrem (Johto no Nv 200); ou uma lista fixa, ex.: kanto,orre
  regioesAuto: /^(auto|)$/i.test(String(env('REGIOES', 'auto')).trim()),
  regioes: String(env('REGIOES', 'auto')).split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && s !== 'auto'),
  huntFixa: env('HUNT_FIXA', ''),             // slug para travar numa hunt
  mortesParaRecuar: num('MORTES_PARA_RECUAR', 3), // desmaios em 10 min para descer um degrau
  logArquivo: env('LOG_ARQUIVO', join(AQUI, 'bot.log')),
  // Outland: sempre nível 150, sem shiny; o tier só multiplica os drops raros
  // (Boss Token, fragmentos). Dentro desta faixa de nível do treinador o bot caça lá.
  outlandDe: num('OUTLAND_DE', 150),
  outlandAte: num('OUTLAND_ATE', 199),
  painelPorta: num('PAINEL_PORTA', 8787),
  painelRede: bool('PAINEL_REDE', '0'),       // 1 = o painel também abre no celular pela rede de casa (só leitura, com senha)
  painelSenha: env('PAINEL_SENHA', ''),       // obrigatória com PAINEL_REDE=1 (8 caracteres ou mais)
  autoVenda: bool('AUTO_VENDA', '1'),
  ouroSaltoMin: num('OURO_SALTO_MIN', 100000), // ganho de uma vez acima disso não entra no ouro/h
  avisoWindows: bool('AVISO_WINDOWS', '1'),
  hpLimiar: num('HP_LIMIAR', 0.6),            // toma poção abaixo desta fração do HP (o jogo vem com 0,3)
  reservaPoderMin: num('RESERVA_PODER_MIN', 0),  // 0 = não tira reserva (só o ativo luta; ele é revivido)
  radar: bool('RADAR', '1'),                 // baixar preços do radar-pokeidle.github.io a cada 6 h
  bosses: bool('BOSSES', '1'),               // boss.auto a partir de BOSS_NIVEL_MIN
  bossNivelMin: num('BOSS_NIVEL_MIN', 3100),  // abaixo disso o token vale mais vendido (~4 Gemas)
  tokenReserva: num('TOKEN_RESERVA', 1),     // tokens guardados para a raid da semana
  raid: bool('RAID', '1'),                   // inscrever na raid semanal (1 token)
  torneios: bool('TORNEIOS', '1'),           // inscrever no campeonato oficial quando der (grátis)
  chocadeira: bool('CHOCADEIRA', '1'),       // pôr Mystery Eggs da mochila para chocar
  ntfyTopico: env('NTFY_TOPICO', ''),            // canal do app ntfy no celular; vazio = desligado
  colecaoNota: bool('COLECAO_NOTA', '1'),        // guardar capturas com nota alta em vez de vender
  colecaoNotaMin: num('COLECAO_NOTA_MIN', 3.5),  // 3,5 = mínimo do Sacrifício e do Mercado
  // rota semanal por espécies novas. Desligada: leva o treinador para hunts de nível 1 (~43 mil XP/h contra ~12 mi)
  // e em 10 h chega só ao marco de 100 (Lure de 30 min). Medido em 24/11.
  topCatch: bool('TOP_CATCH', '0'),
  tcMeta: num('TOP_CATCH_META', 200),           // para ao chegar a tantas espécies na semana
  tcHoras: num('TOP_CATCH_HORAS', 10),          // no máximo tantas horas por semana fora da hunt de XP
  tcMinPorHora: num('TOP_CATCH_MIN_POR_HORA', 4),
  tcSemBoost: bool('TOP_CATCH_SEM_BOOST', '1'),   // espera o XP Boost acabar (não gasta boost em hunt de nível baixo) // rendendo menos que isso de espécies novas por hora, encerra a semana
  mercadoAlerta: bool('MERCADO_ALERTA', '1'),       // avisa item abaixo da média (lista ALERTA_ITENS) e item seu bom para vender
  mercadoAlertaMin: num('MERCADO_ALERTA_MIN', 30),   // minutos entre as checagens do Mercado
  alertaItens: String(env('ALERTA_ITENS', 'AoE TM Disk Piece,Mega Stone Fragment,Mega Shiny Stone Fragment')).split(',').map((x) => x.trim()).filter(Boolean),
  alertaCompraPct: num('ALERTA_COMPRA_PCT', 20),     // anúncio mais barato pelo menos X% abaixo da média (em Gemas)
  alertaVendaPct: num('ALERTA_VENDA_PCT', 30),       // anúncio mais barato pelo menos X% acima da média: dá para vender caro
  sniper: bool('SNIPER', '0'),                       // COMPRA SOZINHO com Gemas (dinheiro real). Desligado por padrão
  sniperRegras: String(env('SNIPER_ITENS', '')).split(',').map((x) => x.trim()).filter(Boolean).map((r) => { const [nome, preco, qtd] = r.split(':').map((y) => y.trim()); return { nome, precoMax: Number(preco) || 0, qtdMax: Number(qtd) || 1 }; }),
  sniperDesconto: num('SNIPER_DESCONTO', 10),        // só compra se o preço estiver pelo menos X% abaixo da média
  sniperOrcamentoDia: num('SNIPER_ORCAMENTO_DIA', 0), // Gemas por dia; 0 = não compra nada
  sniperMin: num('SNIPER_MIN', 5),                   // minutos entre as checagens quando o sniper está ligado
  // Sniper de pokemon: 0 = desligado, observar = só registra o que compraria, 1 = COMPRA SOZINHO com Gemas (dinheiro real)
  sniperPk: String(env('SNIPER_PK', '0')).trim().toLowerCase(),
  sniperPkSeg: Math.max(1, num('SNIPER_PK_SEG', 5)),       // segundos entre as olhadas nos anúncios novos (eles ficam 2 min retidos)
  sniperPkMax: num('SNIPER_PK_MAX', 1500),                // no máximo tantas Gemas por pokemon
  sniperPkDia: num('SNIPER_PK_DIA', 2000),                // no máximo tantas Gemas por dia
  sniperPkQtdDia: num('SNIPER_PK_QTD_DIA', 3),            // no máximo tantas compras por dia
  sniperPkReserva: num('SNIPER_PK_RESERVA', 500),         // nunca deixa o saldo de Gemas abaixo disso
  sniperPkLucro: num('SNIPER_PK_LUCRO', 30),              // só compra se a revenda, já sem a taxa, render pelo menos X% sobre o preço
  sniperPkVendas: num('SNIPER_PK_VENDAS', 5),             // vendas parecidas mínimas para confiar no preço de referência
  sniperPkSoShiny: bool('SNIPER_PK_SO_SHINY', '1'),       // pokemon sem shiny quase não vende (25/11: Charizard P5 Nv80 saiu por 55 Gemas)
  // Revenda do que o sniper comprou: ANUNCIA SOZINHO no Mercado. Desligada por padrão
  sniperPkRevender: bool('SNIPER_PK_REVENDER', '0'),
  sniperPkAbaixo: num('SNIPER_PK_ABAIXO', 10),            // anuncia tantas Gemas abaixo do menor entre a média e o anúncio mais barato
  sniperPkMargem: num('SNIPER_PK_MARGEM', 10),            // piso: ganho mínimo em % sobre o que pagou, já sem a taxa do Mercado
  sniperPkRevDias: num('SNIPER_PK_REV_DIAS', 3),          // dias na vitrine (o jogo cobra a pensão em ouro por dia)
  prey: bool('PREY', '1'),                       // cartela grátis do Prey todo dia (18h), escolhendo espécie da hunt atual
  pvp: bool('PVP', '1'),                         // fila automática do PvP Ranqueado (VIP; luta sem parar a hunt)
  sacrificio: bool('SACRIFICIO', '1'),           // nota 3,5 até SACRIFICIO_NOTA_MAX vira pontos de +20% XP
  sacNotaMax: num('SACRIFICIO_NOTA_MAX', 5),     // nota >= isso fica guardada (pode valer Gemas no Mercado)
  sacResgatarPts: num('SACRIFICIO_RESGATAR_PTS', 1000), // resgata só no nível 5 (14 dias, o que rende mais por ponto)
  equipeMax: num('EQUIPE_MAX', 1),               // só o ativo luta; reserva ocupa vaga e trava a captura no Depot
  timeForte: bool('TIME_FORTE', '0'),            // 1 = equipe com o mais forte de cada espécie; o bot vende no Depot as capturas mais fracas
  vendaNotaMax: Math.min(3.5, num('VENDA_NOTA_MAX', 3.5)), // com TIME_FORTE só vai ao NPC nota abaixo disto (o Mercado aceita 3,5+)
  vendaLote: Math.max(1, num('VENDA_LOTE', 20)),  // com TIME_FORTE, só se o servidor não vender na hora: vai ao Centro ao juntar tantas
  vendaMaxMin: Math.max(1, num('VENDA_MAX_MIN', 60)), // ...ou depois de tantos minutos, se houver pelo menos uma
  manterAcordado: bool('MANTER_ACORDADO', '1'),
  gerirEquipe: bool('GERIR_EQUIPE', '1'),
  evoluir: bool('EVOLUIR', '1'),
  evoNivelMin: num('EVO_NIVEL_MIN', 20),
  pedraPrecoMax: num('PEDRA_PRECO_MAX', 300000),
  pedraFracaoMax: num('PEDRA_FRACAO_MAX', 0.6),   // pedra de evolução pode usar até esta fração do ouro
  huntPorTipo: bool('HUNT_POR_TIPO', '1'),
  ouroPiso: num('OURO_PISO', 200000),          // abaixo disso: modo economia (hunt pelo ouro/h); 0 = desligado
  huntValor: bool('HUNT_VALOR', '1'),          // no degrau escolhido, preferir a hunt de shiny mais caro
  huntValorFolga: num('HUNT_VALOR_FOLGA', 0.9), // aceita tipo até 10% pior que o da melhor hunt
  huntValorSemDado: num('HUNT_VALOR_SEM_DADO', 500), // espécie sem venda no Radar conta como isto
  huntMedir: bool('HUNT_MEDIR', '1'),          // escolher entre os 2 degraus de cima pelo XP/h medido
  medirMin: num('MEDIR_MIN', 10),             // minutos de medição por degrau
  medirValidadeNiveis: num('MEDIR_VALIDADE_NIVEIS', 5), // medição vence após N níveis do treinador
  // degrau de baixo que perdeu por esta folga (1,3 = 30%) não é medido de novo a cada 5 níveis:
  // em 24/11 ir ao nível 80 só para remedir tomou 80 de 248 min, a ~4,4 mi XP/h contra ~11,5 mi no nível 100
  medirFolga: num('MEDIR_FOLGA', 1.3),
  huntHisterese: num('HUNT_HISTERESE', 1.1),
  huntPermanenciaMin: num('HUNT_PERMANENCIA_MIN', 15),
  medirPerdedorNiveis: num('MEDIR_PERDEDOR_NIVEIS', 30), // depois de tantos níveis, o perdedor é medido de novo
};

// shared/outland-tiers.mjs: [nível mínimo, multiplicador de drop]; tier = 101 + índice
const OUTLAND_ESCADA = [[150, 1], [500, 1.1], [750, 1.15], [1000, 1.25], [1250, 1.3], [1500, 1.5], [1800, 1.65], [2000, 1.85], [2250, 2], [2500, 2.15], [3000, 2.3], [3250, 2.45], [3500, 2.6], [4000, 2.75], [5000, 3], [6000, 3.25], [7000, 3.5], [8000, 3.75], [10000, 4], [11000, 4.25], [12000, 4.5], [14000, 5], [15000, 5.25], [17000, 6], [19000, 6.5], [21000, 7], [24000, 7.5], [28000, 8], [32000, 8.5], [36000, 9], [38000, 9.5], [40000, 10], [41000, 10.5], [43000, 11], [45000, 12], [48000, 13], [52000, 14], [58000, 16], [60000, 17], [65000, 20]];
const melhorTierOutland = (lv) => { let t = 101; OUTLAND_ESCADA.forEach(([n], i) => { if (lv >= n) t = 101 + i; }); return t; };
// Pausa: criada quando o jogo é aberto no navegador (sessão tomada). Enquanto for
// recente, o bot nem conecta — para não derrubar quem está jogando.
const ARQ_PAUSA = join(AQUI, 'PAUSADO');
CFG.pausaHoras = num('PAUSA_HORAS', 2);
if (existsSync(ARQ_PAUSA)) {
  const idade = (Date.now() - statSync(ARQ_PAUSA).mtimeMs) / 3600_000;
  if (idade < CFG.pausaHoras) { console.log(`PAUSADO há ${idade.toFixed(1)} h (menos de ${CFG.pausaHoras} h). Saindo.`); process.exit(0); }
  try { unlinkSync(ARQ_PAUSA); } catch {}
}
// Uma cópia só: duas conexões na mesma conta se derrubam (4001).
const ARQ_PID = join(AQUI, 'bot.pid');
if (existsSync(ARQ_PID)) {
  const pid = Number(readFileSync(ARQ_PID, 'utf8'));
  let vivo = false;
  try { if (pid && pid !== process.pid) { process.kill(pid, 0); vivo = true; } } catch {}
  if (vivo) { console.log(`já existe um bot rodando (PID ${pid}). Saindo.`); process.exit(0); }
}
writeFileSync(ARQ_PID, String(process.pid));
process.on('exit', () => { try { if (Number(readFileSync(ARQ_PID, 'utf8')) === process.pid) unlinkSync(ARQ_PID); } catch {} });
if (!CFG.nick || !CFG.token) {
  console.error('Faltam POKEIDLE_NICK e POKEIDLE_TOKEN no .env (veja README.md).');
  process.exit(1);
}

// ---------- ids da loja (de /assets/items.json e welcome.catalogoBolas) ----------
const POCOES = [ // id, cura, preço NPC
  { id: 200, cura: 60, preco: 50 },
  { id: 201, cura: 150, preco: 150 },
  { id: 202, cura: 400, preco: 400 },
  { id: 203, cura: 1000, preco: 800 },
  { id: 204, cura: 3000, preco: 1500 },
];
const REVIVE = { id: 205, preco: 600 };

// ---------- log ----------
const LOG_BUF = [];
const SSE = new Set();
function log(...a) {
  const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${a.join(' ')}`;
  console.log(linha);
  try { appendFileSync(CFG.logArquivo, linha + '\n'); } catch {}
  LOG_BUF.push(linha); if (LOG_BUF.length > 300) LOG_BUF.shift();
  for (const r of SSE) { try { r.write(`data: ${JSON.stringify(linha)}\n\n`); } catch {} }
}

// ---------- estado ----------
const S = {
  ws: null,
  conectadoEm: 0,
  welcome: false,
  hunts: [],
  bolas: [],          // catalogoBolas
  eu: null,           // estado mesclado
  pokemons: new Map(),
  mobs: new Map(),    // campo
  lancados: new Map(), // slot → última bola
  drops: new Map(),    // nome → quantidade nesta sessão
  dropsVistos: new Set(),
  capturados: [],      // últimos capturados
  shinyVistos: new Set(), // slots de campo já avisados
  alertas: [],         // avisos de shiny (painel)
  maxEquipe: 5,
  mortes: [],         // timestamps de desmaio do nosso time
  ultimaTrocaHunt: 0,
  ultimaCompra: 0,
  ultimoPasse: 0,
  ultimaCura: 0,
  parar: false,
  tentativas: 0,
  stats: { inicio: Date.now(), xp0: null, nivel0: null, ouro0: null, abates: 0, capturas: 0, bolas: 0, desmaios: 0 },
};

function mesclarEstado(p) {
  if (!p) return;
  const { cheio, pokemons, pkMud, pkFora, dexMud, dexFora, ...resto } = p;
  if (cheio || !S.eu) {
    S.eu = { ...resto };
    S.pokemons = new Map((pokemons ?? []).map((k) => [k.id, k]));
  } else {
    Object.assign(S.eu, resto);
    if (pokemons) S.pokemons = new Map(pokemons.map((k) => [k.id, k]));
    for (const k of pkMud ?? []) S.pokemons.set(k.id, k);
    for (const id of pkFora ?? []) S.pokemons.delete(id);
  }
  if (S.stats.xp0 == null && S.eu.level != null) {
    S.stats.nivel0 = S.eu.level; S.stats.xp0 = xpAtualDe(S.eu); S.stats.ouro0 = S.eu.gold ?? 0;
  }
}

function aplicarCampo(m) {
  if (m.t === 'campo.init') S.mobs.clear();
  for (const b of m.mobs ?? []) {
    const e = S.mobs.get(b.s) ?? { slot: b.s };
    if (b.n !== undefined) e.nome = b.n;
    if (b.nv !== undefined) e.nivel = b.nv;
    if (b.hp !== undefined) e.hp = b.hp;
    if (b.c !== undefined) e.c = b.c;
    if (b.r !== undefined) e.r = b.r;
    if (b.mhp !== undefined) e.mhp = b.mhp;
    if (b.sh !== undefined) e.shiny = !!b.sh;
    if (b.tr !== undefined) e.treinador = !!b.tr;
    if (b.dn !== undefined) e.dono = b.dn;
    // pet em treino, boneco, enfermeira e pokemon de time (Centro, torneio) não são selvagens
    if (b.ti !== undefined || b.bn || b.cura || b.eq !== undefined) e.naoSelvagem = true;
    if (b.x !== undefined) e.morto = !!b.x;
    if (b.xr !== undefined) e.expiraEm = Date.now() + b.xr;
    S.mobs.set(b.s, e);
    if (e.shiny && !e.treinador && !e.naoSelvagem && !S.eu?.noCentro && !S.shinyVistos.has(b.s)) {
      S.shinyVistos.add(b.s);
      const deOutro = e.dono != null && e.dono !== S.eu?.id && e.dono !== S.eu?.nick && e.dono !== CFG.nick;
      log(`shiny no campo, dado bruto: ${JSON.stringify(b).slice(0, 300)}`);
      if (!deOutro) { ACUM.shinyNoCampo++; hoje().shinyCampo++; }
      avisarShiny('campo', `✨ Shiny no campo: ${e.nome ?? '?'} Nv${e.nivel ?? '?'}`, deOutro ? 'É de outro jogador.' : 'O bot (ou o Auto-Catch do VIP) está lançando bolas.', { nome: e.nome, level: e.nivel, deOutro });
    }
  }
  for (const s of m.fora ?? []) { S.mobs.delete(s); S.lancados.delete(s); S.shinyVistos.delete(s); }
}

// ---------- curvas (copiadas do cliente; ver RELATORIO.md) ----------
// estado.xp = XP total atual; xpNivel = total no início do nível; xpProximo = total no próximo nível
const xpAtualDe = (e) => Number(e?.xp ?? 0);
const progressoNivel = (e) => { const a = Number(e?.xpNivel ?? 0), b = Number(e?.xpProximo ?? 0), x = Number(e?.xp ?? 0); return b > a ? Math.max(0, Math.min(1, (x - a) / (b - a))) : 0; };
const xpTotal = (L) => (L <= 1 ? 0 : Math.round((50 / 3) * (L ** 3 - 6 * L ** 2 + 17 * L - 12)));

// ---------- envio com espaçamento (o servidor segura rajadas) ----------
const fila = [];
let enviando = false;
function enviar(obj, { forcar = false, urgente = false } = {}) {
  if (CFG.somenteLer && !forcar) { log('(somente-ler) enviaria', JSON.stringify(obj)); return; }
  if (urgente) fila.unshift(obj); else fila.push(obj);
  if (!enviando) drenar();
}
async function drenar() {
  enviando = true;
  while (fila.length) {
    if (Date.now() < (S.devagarAte ?? 0)) { await new Promise((r) => setTimeout(r, S.devagarAte - Date.now())); continue; }
    const o = fila.shift();
    if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(o));
    await new Promise((r) => setTimeout(r, 350));
  }
  enviando = false;
}

// ---------- decisões ----------
const ativo = () => S.pokemons.get(S.eu?.activeId);
const equipe = () => [...S.pokemons.values()].filter((p) => p.slot != null && p.slot >= 0 && p.slot < 5);
const timeCaido = () => { const t = equipe(); return t.length > 0 && t.every((p) => (p.hp ?? 1) <= 0); };

// ---------- XP/h medido por degrau ----------
// chave: região:nível do degrau → { xp, seg, mortes, lv (nível do treinador quando começou a medir) }
function medicoes() { if (ACUM.medicoesVersao !== 2) { ACUM.medicoes = {}; ACUM.medicoesVersao = 2; } ACUM.medicoes ??= {}; return ACUM.medicoes; }
// regiões: com REGIOES=auto entram todas as áreas de hunt menos a Outland (que tem regra própria), cada uma
// quando o treinador alcança a hunt mais baixa dela. Em 24/11 o jogo tinha kanto (1–470, Johto incluída) e orre (500+).
function regioesAtivas() {
  if (!CFG.regioesAuto) return CFG.regioes;
  const lv = S.eu?.level ?? 1; const min = {};
  for (const h of S.hunts) if (h.area && h.area !== 'outland') min[h.area] = Math.min(min[h.area] ?? Infinity, h.nivel ?? 0);
  return Object.keys(min).filter((a) => lv >= min[a]);
}
// chave das medições: 'r' para várias regiões (é a mesma desde a versão 2 das medições)
const areaChave = (regs) => (CFG.regioesAuto || regs.length !== 1 ? 'r' : regs[0]);
// a medição vale por MEDIR_VALIDADE_NIVEIS níveis, ou pelos níveis que a conta sobe em 30 min, o que for maior
// (com boost forte, tipo XP ×10, sobe ~1 nível/min e 5 níveis venciam antes dos 10 min de medição)
function validadeNiveis() {
  const lv = S.eu?.level ?? 0; const agora = Date.now();
  const h = (ACUM.lvHist ??= []); if (!h.length || agora - h[h.length - 1][0] > 60_000) h.push([agora, lv]);
  while (h.length > 2 && agora - h[1][0] > 3600_000) h.shift();
  const [t0, lv0] = h[0]; const horas = (agora - t0) / 3600_000;
  const porMeiaHora = horas > 0.05 ? Math.ceil(((lv - lv0) / horas) / 2) : 0;
  return Math.max(CFG.medirValidadeNiveis, porMeiaHora);
}
function medValida(m, lv) { return m && m.lv >= lv - validadeNiveis() && m.seg >= CFG.medirMin * 60; }
function degrauMedido(candsIn, lv, regioes) {
  let cands = candsIn;
  if (cands.length < 2) return cands[0] ?? null;
  const area = areaChave(regioes);
  const M = medicoes();
  const largados = S.desistiDegrau ?? {};
  const pkLv = S.pokemons.get(S.eu?.activeId)?.level ?? 0;
  const mataPk = S.mataPk ?? {};
  cands = cands.filter((n) => !(largados[n] != null && largados[n] >= lv) && !(mataPk[n] != null && pkLv < mataPk[n]));
  if (cands.length < 2) return cands[0] ?? null;
  // degrau mais baixo que já perdeu para um mais alto (medição deste ainda válida) não é medido de novo:
  // com o treinador subindo, a vantagem do degrau de cima só aumenta
  const chave = (n) => `${area}:${n}`;
  const taxa = (n) => { const m = M[chave(n)]; return m && m.seg >= CFG.medirMin * 60 ? m.xp / m.seg : null; };
  const eco = modoEconomia();
  // o de baixo pode voltar a ganhar quando a diferença é pequena (Nv 42: nível 30 389 mil × nível 40 348 mil XP/h),
  // então só pula a remedição quando o de cima, com medição válida, ganhou com folga
  if (!eco && CFG.medirFolga > 0) {
    const vencedor = (n) => { const tn = taxa(n); const mn = M[chave(n)]; if (tn == null || medValida(mn, lv) || mn.lv < lv - CFG.medirPerdedorNiveis) return null; return cands.find((o) => o > n && medValida(M[chave(o)], lv) && taxa(o) >= tn * CFG.medirFolga) ?? null; };
    const largar = cands.map((n) => [n, vencedor(n)]).filter(([, o]) => o != null);
    if (largar.length) {
      cands = cands.filter((n) => !largar.some(([x]) => x === n));
      const txt = largar.map(([n, o]) => `nível ${n} perdeu para o ${o} por ${(taxa(o) / taxa(n)).toFixed(1)}×`).join(', ');
      const chPulo = largar.map(([n, o]) => `${n}>${o}`).join(','); // a razão oscila 1.5/1.6 e repetia o log a cada 3 s
      if (S.ultimoPulo !== chPulo) { S.ultimoPulo = chPulo; log(`degrau medido: não meço de novo (${txt}; volto a medir em ${CFG.medirPerdedorNiveis} níveis)`); }
    }
    if (cands.length < 2) return cands[0] ?? null;
  }
  const valida = (n) => { const m = M[`${area}:${n}`]; return medValida(m, lv) && (!eco || (m.ouroSeg ?? 0) >= CFG.medirMin * 60); };
  const sem = cands.find((n) => !valida(n));
  if (sem != null) return sem; // explora (o mais alto primeiro, pela ordem)
  const metrica = (n) => { const m = M[`${area}:${n}`]; return eco ? m.ouro / m.ouroSeg : m.xp / m.seg; };
  let melhor = [...cands].sort((a, b) => metrica(b) - metrica(a))[0];
  // histerese: medições quase iguais (25/11: 1,86 bi × 1,86 bi XP/h) faziam trocar 850 ↔ 1000 a cada 2 min;
  // só sai do degrau atual se o outro render HUNT_HISTERESE a mais e depois de HUNT_PERMANENCIA_MIN nele
  // (a permanência conta desde que o bot chegou no degrau atual; só segura o degrau que ele mesmo escolheu por comparação,
  // não o que estava só explorando nem o de onde está saindo — 25/11 12:32 a trava segurou o 850 durante a viagem para o 1000)
  const nAtual = S.hunts.find((h) => h.slug === S.eu?.huntSlug)?.nivel;
  if (nAtual !== S.nivelAtual) { S.nivelAtual = nAtual; S.nivelAtualDesde = Date.now(); }
  if (nAtual != null && nAtual !== melhor && nAtual === S.degrauEscolhido && cands.includes(nAtual)) {
    const cedo = Date.now() - (S.nivelAtualDesde ?? 0) < CFG.huntPermanenciaMin * 60_000;
    if (cedo || metrica(melhor) < metrica(nAtual) * CFG.huntHisterese) melhor = nAtual;
  }
  S.degrauEscolhido = melhor;
  const resumo = cands.map((n) => { const m = M[`${area}:${n}`]; return `nível ${n}: ${Math.round(m.xp / m.seg * 3600).toLocaleString('pt-BR')} XP/h${m.ouroSeg ? `, ${Math.round(m.ouro / m.ouroSeg * 3600).toLocaleString('pt-BR')} ouro/h` : ''}`; }).join(' · ');
  const chaveLog = `${eco ? 'eco' : 'xp'}:${melhor}`;
  if (S.ultimoDegrauMed !== chaveLog) { S.ultimoDegrauMed = chaveLog; log(`degrau medido${eco ? ' (economia, pelo ouro)' : ''} → nível ${melhor} (${resumo})`); }
  return melhor;
}
// ouro + estoque a preço de loja: comprar não muda este valor; gastar poção, revive ou bola diminui
const PRECO_BOLA = { 1: 5, 2: 20, 3: 50, 4: 130 };
function patrimonioOuro(e) {
  const it = e.items ?? {}, b = e.balls ?? {};
  return (e.gold ?? 0) + POCOES.reduce((s, p) => s + (it[p.id] ?? 0) * p.preco, 0) + (it[REVIVE.id] ?? 0) * REVIVE.preco
    + Object.entries(PRECO_BOLA).reduce((s, [id, pr]) => s + (b[id] ?? 0) * pr, 0);
}
// modo economia: abaixo de OURO_PISO escolhe o degrau pelo ouro/h medido; sai quando passa de 2× o piso
function modoEconomia() {
  const g = S.eu?.gold; if (g == null || !CFG.ouroPiso) return false;
  if (!S.economia && g < CFG.ouroPiso) { S.economia = true; S.ultimoDegrauMed = null; log(`modo economia: ouro ${Math.round(g).toLocaleString('pt-BR')} abaixo de ${CFG.ouroPiso.toLocaleString('pt-BR')}; escolho a hunt pelo ouro/h até passar de ${(2 * CFG.ouroPiso).toLocaleString('pt-BR')}`); }
  else if (S.economia && g > 2 * CFG.ouroPiso) { S.economia = false; S.ultimoDegrauMed = null; log('modo economia: desligado, ouro recuperado; volto a escolher pela XP/h'); }
  return S.economia;
}
function medirDegrau() {
  const e = S.eu; if (!e?.level) return;
  const agora = Date.now();
  const xpAgora = xpAtualDe(e);
  const patAgora = patrimonioOuro(e);
  const ant = S.medAnterior; S.medAnterior = { em: agora, xp: xpAgora, pat: patAgora, vendas: S.vendasTotal, slug: e.huntSlug, centro: !!e.noCentro };
  if (!ant || ant.slug !== e.huntSlug || !e.huntSlug) return;
  const h = S.hunts.find((x) => x.slug === e.huntSlug); if (!h) return;
  const dt = (agora - ant.em) / 1000; if (dt <= 0 || dt > 60) return;
  const naFaixaOutland = e.level >= CFG.outlandDe && e.level <= CFG.outlandAte;
  const area = naFaixaOutland && h.area === 'outland' ? 'outland' : areaChave(regioesAtivas());
  const k = `${area}:${h.nivel}`; const M = medicoes();
  if (!M[k] || M[k].lv < e.level - validadeNiveis()) M[k] = { xp: 0, seg: 0, lv: e.level };
  M[k].xp += xpAgora - ant.xp; M[k].seg += dt; // o tempo no Centro e a XP perdida ao morrer entram: é o custo real
  // ouro: a venda das capturas entra (é o farm); saltos grandes sem venda (prêmio, pedra no Mercado) ficam fora
  const dOuro = patAgora - (ant.pat ?? patAgora);
  const dVendas = S.vendasTotal - (ant.vendas ?? S.vendasTotal);
  if (ant.pat != null && Math.abs(dOuro - dVendas) < CFG.ouroSaltoMin) { M[k].ouro = (M[k].ouro ?? 0) + dOuro; M[k].ouroSeg = (M[k].ouroSeg ?? 0) + dt; }
}

function huntAlvo() {
  if (CFG.huntFixa) return S.hunts.find((h) => h.slug === CFG.huntFixa) ?? null;
  const tcHunt = huntDoTopCatch(); if (tcHunt) return tcHunt;
  const lv = S.eu?.level ?? 1;
  const agora = Date.now();
  S.mortes = S.mortes.filter((t) => agora - t < 10 * 60_000);
  // só contam as mortes na hunt atual: as de uma hunt que já ficou para trás não penalizam a nova
  const mortesAqui = (S.mortesHunt ?? []).filter(([t, h]) => h === S.eu?.huntSlug && agora - t < 10 * 60_000).length;
  const recuos = Math.floor(mortesAqui / Math.max(1, CFG.mortesParaRecuar));
  // degrau que mata fica de lado pelos níveis que a conta sobe em 30 min (mín. MEDIR_VALIDADE_NIVEIS), não só até o próximo nível
  if (recuos > 0 && S.eu?.huntSlug) { const h = S.hunts.find((x) => x.slug === S.eu.huntSlug); if (h && !((S.desistiDegrau ?? {})[h.nivel] >= lv)) { (S.desistiDegrau ??= {})[h.nivel] = lv + validadeNiveis(); ACUM.desistiDegrau = S.desistiDegrau;
    // o que mata é o pokemon fraco, não o treinador: só volta quando o ativo subir 15 níveis além do que tinha (cada reincidência soma mais 15)
    const pkAt = S.pokemons.get(S.eu?.activeId)?.level ?? 0; S.mataPk ??= {}; S.mataPk[h.nivel] = Math.max(pkAt, S.mataPk[h.nivel] ?? 0) + 15; ACUM.mataPk = S.mataPk;
    log(`hunt: ${h.nome} (nível ${h.nivel}) mata demais; fica de lado até o Nv ${S.desistiDegrau[h.nivel]} e o pokemon ativo no Nv ${S.mataPk[h.nivel]}`); } }
  // teto pelo treinador e pelo pokemon ativo: quem luta é o pokemon. Medido em 24/11: Charizard rende até ~20 níveis
  // acima dele (Sunflora 290 com ele no 265: 465 M XP/h); a ~35 fica lento e a ~50 morre (Politoed 410 com ele no 360)
  const pkAtivo = S.pokemons.get(S.eu?.activeId);
  const tetoPk = pkAtivo?.level ? pkAtivo.level + CFG.huntAcimaPokemon : Infinity;
  const teto = Math.min(lv - CFG.margemNivel, tetoPk);
  if (tetoPk < lv - CFG.margemNivel && S.logTetoPk !== Math.floor(tetoPk / 10)) { S.logTetoPk = Math.floor(tetoPk / 10); log(`hunt: teto pelo pokemon ativo (${pkAtivo.nome} Nv${pkAtivo.level} + ${CFG.huntAcimaPokemon}) = nível ${tetoPk}, abaixo do treinador (Nv ${lv})`); }
  const naFaixaOutland = lv >= CFG.outlandDe && lv <= CFG.outlandAte;
  // Outland não tem shiny: só fica lá se o XP/h medido dela (10 min) for maior que o da hunt normal mais alta
  const outlandPerde = (() => {
    if (!naFaixaOutland) return false;
    const M = medicoes();
    const o = Object.entries(M).find(([k, m]) => k.startsWith('outland:') && medValida(m, lv));
    const lembra = () => lv - (ACUM.outlandPerdeLv ?? -1e9) < validadeNiveis();
    if (!o) return lembra();
    const topo = Math.max(0, ...S.hunts.filter((h) => regioesAtivas().includes(h.area) && h.nivel <= teto).map((h) => h.nivel));
    const r = M[`${areaChave(regioesAtivas())}:${topo}`];
    if (!r || r.seg < CFG.medirMin * 60) return lembra();
    const perde = o[1].xp / o[1].seg < r.xp / r.seg;
    if (perde) ACUM.outlandPerdeLv = o[1].lv; else if (ACUM.outlandPerdeLv != null) delete ACUM.outlandPerdeLv;
    const chave = `${perde}:${o[1].lv}`;
    if (S.logOutland !== chave) { S.logOutland = chave; log(`Outland ${perde ? 'perde' : 'ganha'}: ${Math.round(o[1].xp / o[1].seg * 3600).toLocaleString('pt-BR')} XP/h × nível ${topo} ${Math.round(r.xp / r.seg * 3600).toLocaleString('pt-BR')} XP/h${perde ? ' → volto para a hunt normal (tem shiny) e meço de novo em ' + CFG.medirValidadeNiveis + ' níveis' : ''}`); }
    return perde;
  })();
  const regioes = naFaixaOutland && recuos === 0 && !outlandPerde ? ['outland'] : regioesAtivas();
  const chaveReg = regioes.join(',');
  if (S.ultimasRegioes !== chaveReg) { if (S.ultimasRegioes != null) log(`regiões de hunt: ${chaveReg}`); S.ultimasRegioes = chaveReg; }
  const niveis = [...new Set(S.hunts.filter((h) => regioes.includes(h.area) && h.nivel <= teto).map((h) => h.nivel))].sort((a, b) => b - a);
  if (!niveis.length) return null;
  let nivel = niveis[Math.min(recuos, niveis.length - 1)];
  // em economia compara 4 degraus (os de baixo apanham menos e gastam menos poção); normal, os 2 de cima
  const nCands = modoEconomia() ? 4 : 2;
  if (CFG.huntMedir && !CFG.huntFixa) nivel = degrauMedido(niveis.slice(Math.min(recuos, niveis.length - 1), Math.min(recuos, niveis.length - 1) + nCands), lv, regioes) ?? nivel;
  const opcoes = S.hunts.filter((h) => h.nivel === nivel && regioes.includes(h.area));
  // fica na hunt atual se ela já é desse degrau; senão, a de mais spawns (empate: a primeira)
  const atual = opcoes.find((h) => h.slug === S.eu?.huntSlug);
  if (CFG.huntPorTipo && S.tabelaTipos && ESPECIES.size) {
    const pk = S.pokemons.get(S.eu?.activeId);
    const notas = opcoes.map((h) => ({ h, nota: notaDaHunt(h, pk) })).sort((a, b) => b.nota - a.nota);
    const melhor = notas[0];
    const notaAtual = atual ? notaDaHunt(atual, pk) : 0;
    // entre as hunts com tipo quase tão bom quanto a melhor, a de shiny mais valioso no Mercado
    if (CFG.huntValor && RADAR.hist && notas.length > 1) {
      const parecidas = notas.filter((x) => x.nota >= melhor.nota * CFG.huntValorFolga).map((x) => ({ ...x, valor: valorDaHunt(x.h) })).sort((a, b) => b.valor - a.valor);
      const top = parecidas[0];
      const daAtual = parecidas.find((x) => x.h.slug === atual?.slug);
      const fica = daAtual && daAtual.valor >= top.valor * 0.9;
      const escolha = fica ? daAtual : top;
      if (S.ultimaNotaLog !== escolha.h.slug) {
        S.ultimaNotaLog = escolha.h.slug;
        log(`hunt por valor: ${fica ? 'fica em ' : ''}${escolha.h.nome} (shiny ~${Math.round(escolha.valor).toLocaleString('pt-BR')} Gemas, tipo ${escolha.nota.toFixed(2)}) · outras: ` +
          parecidas.filter((x) => x !== escolha).slice(0, 4).map((x) => `${x.h.nome} ~${Math.round(x.valor).toLocaleString('pt-BR')}`).join(', ') + ` · nível ${nivel}, ${parecidas.length} de ${notas.length} com tipo bom`);
      }
      return escolha.h;
    }
    if (atual && notaAtual >= melhor.nota * 0.95) return atual;
    if (melhor && S.ultimaNotaLog !== melhor.h.slug) { S.ultimaNotaLog = melhor.h.slug; log(`hunt por tipo: ${melhor.h.nome} nota ${melhor.nota.toFixed(2)} (${notas.length} opções no nível ${nivel})`); }
    return melhor.h;
  }
  return atual ?? opcoes.sort((a, b) => (b.totalSpawns ?? 0) - (a.totalSpawns ?? 0))[0];
}

function cuidarDaHunt() {
  if (S.eu?.boss?.arena || S.eu?.boss?.auto) return; // em boss: o servidor cuida
  if (Date.now() < (S.noDepotAte ?? 0)) return; // vendendo no Depot do Centro
  if (S.eu?.noCentro && !timeCaido()) { S.centroDesde ??= Date.now(); if (Date.now() - S.centroDesde > 60_000 && S.eu.huntSlug && Date.now() - (S.ultimaSaidaCentro ?? 0) > 30_000) { S.ultimaSaidaCentro = Date.now(); log('parado no Centro há mais de 1 min; voltando para a hunt'); enviar({ t: 'hunt.select', slug: S.eu.huntSlug }); } } else S.centroDesde = null;
  const agora = Date.now();
  if (timeCaido()) {
    if (agora - S.ultimaCura > 20_000) { log('time caído → curar no Centro'); enviar({ t: 'centro.curar' }); S.ultimaCura = agora; }
    return;
  }
  const alvo = huntAlvo();
  if (!alvo) return;
  // na Outland, manter o maior tier liberado (mais drop raro, mesmo risco)
  if (alvo.area === 'outland') {
    const tier = melhorTierOutland(S.eu?.level ?? 0);
    if (S.eu?.outlandTier !== tier && agora - (S.ultimoTier ?? 0) > 60_000) {
      log(`Outland tier → ${tier - 100}`); enviar({ t: 'outland.tier', tier }); S.ultimoTier = agora;
    }
  }
  if (S.eu?.huntSlug === alvo.slug) return;
  // trava de troca do próprio jogo + nossa folga para não ficar trocando
  if (S.huntPendente?.slug !== alvo.slug) {
    S.huntPendente = { slug: alvo.slug, nivel: alvo.nivel, desde: agora, tentativas: 0 };
    log(`hunt → ${alvo.nome} (${alvo.slug}, nível ${alvo.nivel}, ${alvo.area}); troca assim que o campo esvaziar`);
  }
  // não trocou em 10 min: o degrau fica de fora até o próximo nível (evita insistir para sempre)
  if (agora - S.huntPendente.desde > 600_000) {
    (S.desistiDegrau ??= {})[S.huntPendente.nivel] = (S.eu?.level ?? 0) + validadeNiveis(); ACUM.desistiDegrau = S.desistiDegrau;
    log(`hunt: não consegui trocar para ${alvo.nome} em 10 min; deixo o nível ${S.huntPendente.nivel} de lado até o próximo nível`);
    S.huntPendente = null;
  }
}
function pendurarEquipe(msg) { S.equipePendente = { msg, desde: Date.now() }; }
// chamado a cada 250 ms: manda a troca na janela em que o jogo aceita
function tentarTrocaPendente() {
  const vivoNoCampo = () => [...S.mobs.values()].some((m) => !m.treinador && !m.morto) && S.eu?.huntSlug && !S.eu?.noCentro;
  const q = S.equipePendente;
  if (q && S.eu) {
    if (Date.now() - q.desde > 300_000) { log('equipe: não consegui aplicar a mudança em 5 min; tento de novo depois'); S.equipePendente = null; S.ultimaEquipe = Date.now() + 300_000; }
    else if (!vivoNoCampo() && Date.now() - (S.ultimaEquipeEnvio ?? 0) > 2000) { S.ultimaEquipeEnvio = Date.now(); enviar(q.msg); S.equipePendente = null; S.ultimaEquipe = Date.now(); }
  }
  // fuga: religa revive e voltar-à-hunt quando a troca acontece, quando não há mais troca pendente ou depois de 5 min
  if (S.fuga && S.eu?.automation && (!S.huntPendente || S.eu.huntSlug === S.huntPendente.slug || Date.now() - S.fuga.desde > 300_000)) {
    log(`fuga: ${S.huntPendente && S.eu.huntSlug !== S.huntPendente.slug ? 'não deu em 5 min' : 'troca feita'}; religando revive e voltar à hunt`);
    S.fuga = null; enviar(pacoteAuto(S.eu.automation, { autoRevive: true, autoVoltarHunt: true }));
  }
  const p = S.huntPendente; if (!p || !S.eu) return;
  if (S.eu.huntSlug === p.slug) { S.huntPendente = null; return; }
  const agora = Date.now();
  if (agora < (S.eu.trocaLivreEm ?? 0) || agora - (S.ultimaTrocaHunt ?? 0) < 2000) return;
  const vivo = [...S.mobs.values()].some((m) => !m.treinador && !m.morto);
  // preso numa hunt que mata (o revive devolve o time à mesma luta e o campo nunca esvazia): desliga revive e
  // voltar-à-hunt, o time cai, o bot cura no Centro e de lá a troca entra. Com o Boost dos Atrasados, desmaiar não tira XP.
  if (vivo && S.eu.huntSlug && !S.eu.noCentro && !S.fuga && S.eu.automation && agora - p.desde > 45_000 && (S.mortesHunt ?? []).filter(([t, h]) => h === S.eu.huntSlug && agora - t < 120_000).length >= 2) {
    S.fuga = { desde: agora };
    log(`fuga: preso em ${S.eu.huntSlug} morrendo e sem conseguir trocar; desligo o revive para o time cair, curar no Centro e trocar para ${p.slug}`);
    enviar(pacoteAuto(S.eu.automation, { autoRevive: false, autoVoltarHunt: false }));
  }
  if (vivo && S.eu.huntSlug && !S.eu.noCentro) return;
  p.tentativas++;
  S.ultimaTrocaHunt = agora;
  enviar({ t: 'hunt.select', slug: p.slug });
}

function comprar(kind, id, qty, preco) {
  const ouro = S.eu?.gold ?? 0;
  const max = Math.floor((ouro * CFG.gastoMaxFracao) / preco);
  const q = Math.min(qty, max);
  if (q <= 0) return false;
  log(`comprar ${q}× ${kind}:${id} (${q * preco} de ouro de ${ouro})`);
  const cd = contaDoDia(); if (cd) cd[kind === 'ball' ? 'bolasOuro' : id >= 200 && id <= 206 ? 'pocoesOuro' : 'outrosOuro'] += q * preco;
  enviar({ t: 'shop.buy', kind, id, qty: q });
  return true;
}

// a poção que dá mais HP útil por ouro: o jogo toma poção quando o HP cai abaixo de HP_LIMIAR,
// então falta ~maxHp × (1 − limiar); o que passar disso é desperdício. Para não curar devagar demais,
// só entram poções que curam pelo menos 60% do que falta.
function pocaoCerta(mhp) {
  const falta = Math.max(1, mhp * (1 - CFG.hpLimiar));
  const util = (p) => Math.min(p.cura, falta) / p.preco;
  const ok = POCOES.filter((p) => p.cura >= falta * 0.6);
  if (!ok.length) return POCOES[POCOES.length - 1];
  return ok.sort((a, b) => util(b) - util(a) || b.cura - a.cura)[0];
}
function cuidarDoEstoque() {
  const agora = Date.now();
  if (agora - S.ultimaCompra < 60_000 || !S.eu) return;
  const items = S.eu.items ?? {};
  const balls = S.eu.balls ?? {};
  const mhp = ativo()?.maxHp ?? 100;
  const pocao = pocaoCerta(mhp);
  const totalPocoes = POCOES.reduce((s, p) => s + (items[p.id] ?? 0), 0);
  let comprou = false;
  if (totalPocoes < CFG.minPocoes) comprou = comprar('item', pocao.id, 2 * CFG.minPocoes - totalPocoes, pocao.preco) || comprou;
  const revives = (items[205] ?? 0) + (items[206] ?? 0);
  if (revives < CFG.minRevives) comprou = comprar('item', REVIVE.id, 2 * CFG.minRevives - revives, REVIVE.preco) || comprou;
  if (CFG.modoCaptura !== 'nao') {
    const totalBolas = Object.values(balls).reduce((s, n) => s + n, 0);
    // melhor bola compravel cujo caixa cobre ~30 min de arremessos (~630 bolas); o servidor aceita ~1 a cada 3 s
    const ouro = S.eu.gold ?? 0;
    const alvo = S.bolas.filter((b) => b.compravel && b.priceGold > 0 && ouro >= b.priceGold * 630).sort((x, y) => y.catchRate - x.catchRate)[0] ?? S.bolas.find((b) => b.id === 1);
    const temAlvo = balls[alvo?.id] ?? 0;
    if (alvo?.priceGold && temAlvo < CFG.minBolas) comprou = comprar('ball', alvo.id, 2 * CFG.minBolas - temAlvo, alvo.priceGold) || comprou;
    else if (totalBolas < CFG.minBolas) { const poke = S.bolas.find((b) => b.id === 1); if (poke?.priceGold) comprou = comprar('ball', 1, CFG.minBolas - totalBolas, poke.priceGold) || comprou; }
  }
  if (comprou) S.ultimaCompra = agora;
}

function melhorBola(shiny = false) {
  const balls = S.eu?.balls ?? {};
  // a mais forte que tiver acima da reserva (shiny usa até a última)
  const reserva = shiny ? 0 : CFG.bolaReserva;
  const ord = [...S.bolas].sort((a, b) => b.catchRate - a.catchRate);
  return ord.find((b) => (balls[b.id] ?? 0) > reserva)?.id ?? null;
}

// Captura por objetivo. Com Poke Ball (catchRate 1) a chance máxima é ~0,37%
// (0,0075 × 1/2,8669 × 1,4), ou seja ~270 bolas = ~1.370 de ouro por captura:
// prejuízo se for só para vender. Vale para completar o time (5 vagas) e para shiny.
//   CAPTURAR=time   → só enquanto o time tiver menos de 5 (padrão), e sempre em shiny
//   CAPTURAR=sempre → uma bola em todo caído
//   CAPTURAR=0      → nunca (nem shiny)
function querCapturar(e) {
  if (CFG.modoCaptura === 'nao') return false;
  if (e.shiny) return true;
  if (CFG.modoCaptura === 'sempre' || CFG.modoCaptura === 'rajada') return true;
  return equipe().length < (S.maxEquipe ?? 5);
}

function cuidarDaCaptura() {
  if (CFG.modoCaptura === 'nao' || CFG.modoCaptura === 'vip' || !S.eu?.huntSlug || S.eu?.noCentro) return;
  if (S.eu.loja?.vip && S.eu.automation?.autoBallAteCapturar) return; // o servidor já lança (VIP)
  const agora = Date.now();
  for (const e of S.mobs.values()) {
    if (!e.morto || e.treinador) continue;
    if (e.dono != null && e.dono !== S.eu.id) continue;
    if ((e.expiraEm ?? 0) - agora < 1500) continue;
    if (!querCapturar(e)) continue;
    // shiny: insiste a cada 1,5 s até sumir; resto: uma bola por corpo
    const ultimo = S.lancados.get(e.slot);
    const rajada = e.shiny || (CFG.modoCaptura === 'rajada' && (S.eu.gold ?? 0) > CFG.ouroReservaBolas);
    const intervalo = e.shiny ? Math.min(1500, CFG.rajadaMs) : CFG.rajadaMs;
    if (ultimo && (!rajada || agora - ultimo < intervalo)) continue;
    const bola = melhorBola(e.shiny);
    if (!bola) continue;
    if (e.shiny && !ultimo) log(`✨ shiny caído: ${e.nome} Nv${e.nivel} — lançando até sumir`);
    S.lancados.set(e.slot, agora);
    S.stats.bolas++;
    enviar({ t: 'ball.throw', ballId: bola, slot: e.slot });
  }
}

// ---------- Sacrifício: capturas de nota 3,5+ viram pontos; a barra cheia vira +20% de XP ----------
const RARIDADE_PROTEGIDA = new Set(['LEGENDARY', 'MYTHIC', 'EPIC', 'SEM_CATALOGO']); // sem catálogo, não sacrifica nada
const PONTOS_SAC = [10, 12, 14, 17, 20, 25, 30, 35, 42, 50, 60, 70, 80, 90, 100, 110, 125, 140, 155, 170, 190, 210, 235, 260, 290, 320, 360, 400, 450, 500, 560, 620, 700, 780, 870, 1000];
const pontosDaNota = (n) => { const d = Math.floor(Math.round(Number(n) * 1000) / 100) - 35; return d < 0 || !Number.isFinite(d) ? 0 : PONTOS_SAC[Math.min(d, PONTOS_SAC.length - 1)]; };
function cuidarDoSacrificio() {
  if (!CFG.sacrificio || !S.eu || CFG.somenteLer) return;
  const agora = Date.now();
  if (agora - (S.ultimoSac ?? 0) < 120_000) return;
  S.ultimoSac = agora;
  const sac = S.eu.automation?.sacrificio ?? {};
  const pts = Number(sac.pts) || 0, ate = Number(sac.ate) || 0;
  // resgatar: nível 5 (1000 pts = 14 dias), sem passar do teto de 30 dias guardados
  if (pts >= CFG.sacResgatarPts && Math.max(ate, agora) + 336 * 3600_000 - agora <= 30 * 24 * 3600_000) {
    log(`Sacrifício: resgatando ${pts} pontos (+20% de XP)`); S.depurarAte = agora + 15_000; return enviar({ t: 'sacrificio.resgatar' });
  }
  if (pts >= 1000 || CFG.timeForte) return; // barra cheia, esperando caber no teto; com o time forte nada vai ao altar
  const todos = [...S.pokemons.values()];
  // lendário, mítico e épico (rarity do catálogo; o pokemon não traz esse campo) podem valer Gemas: nunca vão para o altar
  const cands = todos.filter((p) => p.id !== S.eu.activeId && p.slot == null && !p.starter && !p.shiny && !(p.potencia >= 4) && !p.heldItemId
    && !RARIDADE_PROTEGIDA.has(ESPECIES.get(p.speciesId)?.rarity ?? (ESPECIES.size ? '' : 'SEM_CATALOGO'))
    && pontosDaNota(p.nota) > 0 && Number(p.nota) < CFG.sacNotaMax).sort((x, y) => (x.nota ?? 0) - (y.nota ?? 0));
  // o jogo recusa se sobrar menos de 2 pokemon na conta
  const n = Math.min(cands.length, 50, todos.length - 2);
  if (n <= 0) { if (agora - (S.ultimoSacDiag ?? 0) > 30 * 60_000) { S.ultimoSacDiag = agora; log(`Sacrifício: nada a sacrificar (barra ${pts}/1000) · conta: ` + todos.map((p) => `${p.nome}#${p.id} slot=${p.slot ?? '-'} nota=${p.nota ?? '?'} P${p.potencia ?? '?'}${p.id === S.eu.activeId ? ' ativo' : ''}${p.starter ? ' inicial' : ''}${p.heldItemId ? ' item' : ''}`).join(' | ')); } return; }
  const lote = cands.slice(0, n);
  const ganho = lote.reduce((t, p) => t + pontosDaNota(p.nota), 0);
  log(`Sacrifício: ${lote.length}× (${lote.map((p) => `${p.nome} N${Number(p.nota).toFixed(2)}`).slice(0, 6).join(', ')}) → +${ganho} pontos (barra ${pts}/1000)`);
  S.depurarAte = agora + 15_000;
  enviar({ t: 'sacrificio.sacrificar', pokemonIds: lote.map((p) => p.id) });
}

// ---------- Top Catch: espécies diferentes capturadas com bola na semana ----------
// marcos: 100 = Secret Lure 30 min, 150/200/300 = XP Boost duplo + Lure 0,5/1/2 h, 400 = Lure 12 h
function estadoTC() {
  const sem = S.tcSemana ?? S.eu?.topCatch?.s ?? null;
  if (!ACUM.topCatch || ACUM.topCatch.semana !== sem) ACUM.topCatch = { semana: sem, seg: 0, esgotadas: {}, encerrada: null, hist: [] };
  return ACUM.topCatch;
}
function aoTopCatch(m) {
  if (!Array.isArray(m.e) || m.parcial) return;
  const antes = S.tcN;
  S.tcSemana = m.s; S.tcN = Number(m.n) || m.e.length; S.tcChaves = new Set(m.e.map(([k]) => Number(k)));
  if (antes != null && S.tcN > antes) log(`Top Catch: ${S.tcN} espécies na semana (+${S.tcN - antes})`);
}
function tcFaltam(h) {
  // forma/Outland usam outra chave na Pokédex; espécie com id > 1025 fica de fora da conta
  return (h.especies ?? []).filter((e) => Number(e.pokeId) <= 1025 && !S.tcChaves.has(Number(e.pokeId)));
}
function huntDoTopCatch() {
  if (!S.tcAtivo || !S.tcChaves) return null;
  const lv = S.eu?.level ?? 1; const T = estadoTC();
  const cands = S.hunts.filter((h) => h.area !== 'outland' && h.nivel <= lv - CFG.margemNivel && !T.esgotadas[h.slug])
    .map((h) => { const f = tcFaltam(h); const tot = (h.especies ?? []).reduce((t, e) => t + (e.pontos ?? 1), 0) || 1; return { h, f, frac: f.reduce((t, e) => t + (e.pontos ?? 1), 0) / tot }; })
    .filter((x) => x.f.length > 0).sort((x, y) => y.frac - x.frac || y.f.length - x.f.length || x.h.nivel - y.h.nivel);
  const atual = cands.find((x) => x.h.slug === S.eu?.huntSlug);
  const esc = atual && atual.frac >= cands[0]?.frac * 0.8 ? atual : cands[0];
  if (!esc) return null;
  if (S.tcLogHunt !== esc.h.slug) { S.tcLogHunt = esc.h.slug; S.tcHuntDesde = Date.now(); S.tcHuntN = S.tcN; log(`Top Catch: ${esc.h.nome} (nível ${esc.h.nivel}) · faltam ${esc.f.map((e) => ESPECIES.get(Number(e.pokeId))?.nome ?? e.pokeId).join(', ')} (${Math.round(esc.frac * 100)}% dos spawns)`); }
  return esc.h;
}
function cuidarDoTopCatch() {
  if (!CFG.topCatch || !S.eu || CFG.somenteLer) return;
  const agora = Date.now();
  const dt = (agora - (S.tcTick ?? agora)) / 1000; S.tcTick = agora;
  const T = estadoTC();
  if (S.tcAtivo) T.seg += Math.min(dt, 120);
  if (agora - (S.ultimoTcPedido ?? 0) > (S.tcAtivo ? 120_000 : 30 * 60_000)) { S.ultimoTcPedido = agora; enviar({ t: 'topcatch.pedir' }); }
  if (!S.tcChaves) return;
  const bst = S.eu.loja?.boosts ?? {}; const boostAte = Math.max(Number(bst.xp) || 0, Number(bst.pokexp) || 0);
  if (CFG.tcSemBoost && boostAte > agora) {
    if (S.tcAtivo) { S.tcAtivo = false; S.tcLogHunt = null; log('Top Catch: pausado enquanto houver XP Boost; voltando para a hunt de XP'); }
    if (S.tcLogBoost !== Math.round(boostAte / 3600_000)) { S.tcLogBoost = Math.round(boostAte / 3600_000); log(`Top Catch: esperando o XP Boost acabar (${new Date(boostAte).toLocaleString('pt-BR')})`); }
    return;
  }
  // hunt atual sem espécie nova há 20 min: esgotada nesta semana
  if (S.tcAtivo && S.tcLogHunt && agora - (S.tcHuntDesde ?? agora) > 20 * 60_000 && S.tcN === S.tcHuntN) { T.esgotadas[S.tcLogHunt] = true; log(`Top Catch: ${S.tcLogHunt} sem espécie nova em 20 min; próxima`); S.tcLogHunt = null; }
  if (S.tcAtivo && S.tcLogHunt && S.tcN !== S.tcHuntN) { S.tcHuntDesde = agora; S.tcHuntN = S.tcN; }
  // ritmo: espécies novas na última hora de modo ativo
  if (S.tcAtivo) { T.hist.push([Math.round(T.seg), S.tcN]); T.hist = T.hist.filter(([sg]) => T.seg - sg <= 3600); }
  const h0 = T.hist[0]; const ritmoBaixo = S.tcAtivo && h0 && T.seg - h0[0] >= 3500 && (S.tcN - h0[1]) < CFG.tcMinPorHora;
  let motivo = null;
  if (S.tcN >= CFG.tcMeta) motivo = `meta de ${CFG.tcMeta} espécies`;
  else if (T.seg >= CFG.tcHoras * 3600) motivo = `limite de ${CFG.tcHoras} h na semana`;
  else if (ritmoBaixo) motivo = `menos de ${CFG.tcMinPorHora} espécies novas na última hora`;
  else if (T.encerrada) motivo = T.encerrada;
  if (motivo) { if (!T.encerrada) { T.encerrada = motivo; } if (S.tcAtivo) { S.tcAtivo = false; S.tcLogHunt = null; log(`Top Catch: encerrado na semana (${motivo}) com ${S.tcN} espécies em ${(T.seg / 3600).toFixed(1)} h; voltando para a hunt de XP`); } return; }
  if (!S.tcAtivo) { S.tcAtivo = true; log(`Top Catch: começando com ${S.tcN} espécies na semana (meta ${CFG.tcMeta}, até ${CFG.tcHoras} h, ${(T.seg / 3600).toFixed(1)} h usadas)`); }
}

// ---------- Mercado ao vivo: alertas e sniper (opcional) ----------
// Alerta: o anúncio mais barato de um item da lista ALERTA_ITENS está X% abaixo da média de vendas em Gemas, ou um item
// seu (livre, não preso à conta) tem o anúncio mais barato X% acima da média: dá para anunciar caro. Só avisa; não anuncia.
// Sniper (SNIPER=1): compra com market.comprarLote quando o preço fica abaixo do teto da regra e da média − SNIPER_DESCONTO%,
// sem passar do orçamento diário em Gemas. Ideia do pokeidle-manager-online (market_service.py).
function cuidarDoMercadoVivo() {
  if ((!CFG.mercadoAlerta && !CFG.sniper) || !S.eu || CFG.somenteLer || COLETA) return;
  const agora = Date.now(); const intervalo = (CFG.sniper && CFG.sniperOrcamentoDia > 0 ? Math.min(CFG.sniperMin, CFG.mercadoAlertaMin) : CFG.mercadoAlertaMin) * 60_000;
  if (agora - (S.ultimoMkVivo ?? 0) < intervalo) return;
  S.ultimoMkVivo = agora; S.mkVivo = { em: agora };
  enviar({ t: 'market.medias' }); enviar({ t: 'market.itens', elementos: [], categoria: '' });
}
// Patrimônio estimado (painel): só leitura. Pede as médias de preço do Mercado a cada 30 min e valora gemas, itens da mochila,
// shinies e ouro. Câmbio do servidor: 1 Orb ("Gema") = US$ 0,009 no saque; taxa do Mercado de itens 15%, de Pokémon 13/10/7,5%.
function cuidarDosPrecos() {
  if (!S.eu || COLETA || Date.now() - (S.ultimoPrecos ?? 0) < 30 * 60_000) return;
  S.ultimoPrecos = Date.now(); enviar({ t: 'market.medias' });
}
function patrimonio(e) {
  const P = S.precos; if (!P) return null;
  const orbDe = (id) => { const o = P.medias[id]?.orb; return o?.media > 0 && o.unidades >= 10 ? o : null; };
  // quantos de ouro valem 1 Orb: mediana dos itens vendidos nas duas moedas (com preço em Orbs alto o bastante para não ser arredondamento)
  const razoes = Object.values(P.medias).filter((x) => x.orb?.media >= 50 && x.orb.unidades >= 50 && x.gold?.media > 0).map((x) => x.gold.media / x.orb.media);
  const ouroPorOrb = mediana(razoes) ?? 4_800_000;
  const nomes = Object.fromEntries([...ITEM_POR_NOME].map(([n, id]) => [id, n]));
  const itens = [], semPreco = [];
  for (const [id, q] of Object.entries(e.items ?? {})) {
    if (!(q > 0)) continue;
    const o = orbDe(id);
    if (!o) { if (P.medias[id]) semPreco.push(nomes[id] ?? id); continue; }
    itens.push({ id: Number(id), nome: nomes[id] ?? `item ${id}`, qtd: q, preco: o.media, vendas: o.unidades, total: q * o.media });
  }
  itens.sort((a, b) => b.total - a.total);
  const shinies = [...S.pokemons.values()].filter((p) => p.shiny).map((p) => { const r = precoShiny(p.nome); return r.sugerido ? { nome: p.nome, nv: p.level, bruto: r.sugerido, liquido: r.liquido } : null; }).filter(Boolean).sort((a, b) => b.bruto - a.bruto);
  const gemas = Number(e.orbs) || 0, ouro = e.gold ?? 0, ouroOrb = ouro / ouroPorOrb;
  const itensBruto = itens.reduce((t, i) => t + i.total, 0), shBruto = shinies.reduce((t, s) => t + s.bruto, 0), shLiq = shinies.reduce((t, s) => t + s.liquido, 0);
  const bruto = gemas + itensBruto + shBruto + ouroOrb, liquido = gemas + itensBruto * 0.85 + shLiq + ouroOrb;
  return { em: P.em, dias: P.dias, ouroPorOrb: Math.round(ouroPorOrb), gemas, ouro, ouroOrb: Math.round(ouroOrb), itens: itens.slice(0, 12), outrosItens: Math.max(0, itens.length - 12), semPreco, shinies: shinies.slice(0, 8), nShinies: shinies.length,
    bruto: Math.round(bruto), liquido: Math.round(liquido), usd: +(liquido * 0.009).toFixed(2), usdBruto: +(bruto * 0.009).toFixed(2) };
}
function aoMercadoVivo(m) {
  if (!S.mkVivo || Date.now() - S.mkVivo.em > 60_000) return;
  if (m.aba === 'medias') S.mkVivo.medias = m.medias ?? {};
  if (m.aba === 'itens') { S.mkVivo.resumo = m.resumo ?? {}; if (m.medias && !S.mkVivo.medias) S.mkVivo.medias = m.medias; }
  if (!S.mkVivo.medias || !S.mkVivo.resumo || S.mkVivo.feito) return;
  S.mkVivo.feito = true;
  const antes = S.alertas.length;
  try { avaliarMercado(S.mkVivo.medias, S.mkVivo.resumo); } catch (e) { log('mercado ao vivo:', e.message); }
  log(`mercado ao vivo: ${Object.keys(S.mkVivo.resumo).length} itens conferidos, ${S.alertas.length - antes} aviso(s)${CFG.sniper && CFG.sniperOrcamentoDia > 0 ? ' · sniper ligado' : ''}`);
}
function avaliarMercado(medias, resumo) {
  const agora = Date.now(); const nomeDe = new Map([...ITEM_POR_NOME].map(([n, id]) => [id, n]));
  const avisados = (S.mkAvisos ??= {});
  const pode = (chave, preco) => { const v = avisados[chave]; if (v && agora - v.em < 6 * 3600_000 && preco >= v.preco * 0.9) return false; avisados[chave] = { em: agora, preco }; return true; };
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  if (CFG.mercadoAlerta) {
    for (const nome of CFG.alertaItens) {
      const id = ITEM_POR_NOME.get(nome); const r = resumo[id]; const md = medias[id]?.orb;
      if (!id || !r?.minOrb || !md?.media || (md.unidades ?? 0) < 3) continue;
      if (r.minOrb < md.media * 0.1) continue; // preço de fachada (anúncio isca, ver regra de manipulação do Mercado)
      if (r.minOrb <= md.media * (1 - CFG.alertaCompraPct / 100) && pode('c' + id, r.minOrb))
        avisarShiny('mercado', `💰 ${nome} barato: ${fmt(r.minOrb)} Gemas`, `Média de venda ${fmt(md.media)} Gemas (${Math.round((1 - r.minOrb / md.media) * 100)}% abaixo). Só aviso: o bot não compra sozinho (SNIPER=0).`);
    }
    const presos = S.eu.automation?.itensPresos ?? {};
    for (const [idStr, qtd] of Object.entries(S.eu.items ?? {})) {
      const id = Number(idStr); const livre = (Number(qtd) || 0) - (Number(presos[idStr]) || 0);
      const r = resumo[id]; const md = medias[id]?.orb;
      if (livre <= 0 || !r?.minOrb || !md?.media || (md.unidades ?? 0) < 3) continue;
      if (r.minOrb >= md.media * (1 + CFG.alertaVendaPct / 100) && pode('v' + id, -r.minOrb))
        avisarShiny('mercado', `📈 Bom para vender: ${nomeDe.get(id) ?? 'item ' + id}`, `Você tem ${livre} livre(s). O anúncio mais barato está em ${fmt(r.minOrb)} Gemas, ${Math.round((r.minOrb / md.media - 1) * 100)}% acima da média (${fmt(md.media)}). Anunciar é com você.`);
    }
  }
  if (CFG.sniper && CFG.sniperOrcamentoDia > 0) {
    const dia = new Date().toISOString().slice(0, 10);
    const G = (ACUM.sniper && ACUM.sniper.dia === dia) ? ACUM.sniper : (ACUM.sniper = { dia, gasto: 0, qtd: {} });
    for (const rg of CFG.sniperRegras) {
      const id = ITEM_POR_NOME.get(rg.nome); const r = resumo[id]; const md = medias[id]?.orb;
      if (!id || !r?.minOrb || !rg.precoMax) { if (!id) log(`sniper: item "${rg.nome}" não existe no catálogo`); continue; }
      const teto = Math.min(rg.precoMax, md?.media ? Math.floor(md.media * (1 - CFG.sniperDesconto / 100)) : rg.precoMax);
      if (r.minOrb > teto || (md?.media && r.minOrb < md.media * 0.1)) continue; // acima do teto, ou isca abaixo de 10% da média
      const resta = CFG.sniperOrcamentoDia - G.gasto; const saldo = Number(S.eu.orbs) || 0;
      const qtd = Math.min(rg.qtdMax - (G.qtd[id] ?? 0), Math.floor(Math.min(resta, saldo) / teto), Number(r.unidades) || rg.qtdMax);
      if (qtd < 1) continue;
      G.gasto += qtd * teto; G.qtd[id] = (G.qtd[id] ?? 0) + qtd; S.depurarAte = Date.now() + 20_000;
      log(`sniper: comprando até ${qtd}× ${rg.nome} a no máximo ${teto} Gemas cada (mais barato agora ${r.minOrb}; média ${md?.media ? fmt(md.media) : '?'}) · gasto hoje ${G.gasto}/${CFG.sniperOrcamentoDia} Gemas`);
      enviar({ t: 'market.comprarLote', tipo: 'item', itemId: id, moeda: 'orb', qtd, precoMax: teto, totalMax: qtd * teto });
    }
  }
}

// ---------- Sniper de pokemon (SNIPER_PK=observar|1) ----------
// O Mercado segura todo anúncio novo por 2 min (compravelEm) e, quando libera, sorteia entre quem pediu nos primeiros 3 s;
// quem perde não paga (i18n market.sorteio / aviso.v28Sorteio). Então não adianta olhar a cada segundo: o bot olha os
// anúncios mais recentes a cada SNIPER_PK_SEG, avalia durante a retenção e pede na liberação.
// Preço de referência: mediana das vendas reais parecidas (mesma espécie, shiny, potência e AoE, nível próximo, 14 dias),
// e, no shiny, também a mediana do Radar para a espécie; vale a menor das duas. Só compra se a revenda sem a taxa render
// SNIPER_PK_LUCRO% sobre o preço. Nunca anuncia para revender: isso é com o dono da conta.
const SN = { vendas: new Map(), carregado: false, tentados: new Set(), ultimaOlhada: 0, ultimoHist: 0, olhadas: 0, vistos: 0, ultimaResposta: 0, eventos: [] };
// o que o painel mostra: as últimas decisões (compraria, vou pedir, comprou, não levou, barrado)
function snEvento(acao, desc, extra = {}) { SN.eventos.unshift({ em: Date.now(), acao, desc, ...extra }); SN.eventos.length = Math.min(SN.eventos.length, 40); }
// campos que o painel pode mudar: nome no CFG, chave do .env, validação
const SN_CAMPOS = {
  modo: ['sniperPk', 'SNIPER_PK', (v) => (['0', 'observar', '1'].includes(String(v)) ? String(v) : null)],
  seg: ['sniperPkSeg', 'SNIPER_PK_SEG', (v) => (Number(v) >= 3 && Number(v) <= 600 ? Number(v) : null)],
  max: ['sniperPkMax', 'SNIPER_PK_MAX', (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null)],
  dia: ['sniperPkDia', 'SNIPER_PK_DIA', (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null)],
  qtdDia: ['sniperPkQtdDia', 'SNIPER_PK_QTD_DIA', (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 50 ? Number(v) : null)],
  reserva: ['sniperPkReserva', 'SNIPER_PK_RESERVA', (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null)],
  lucro: ['sniperPkLucro', 'SNIPER_PK_LUCRO', (v) => (Number(v) >= 5 && Number(v) <= 500 ? Number(v) : null)],
  vendas: ['sniperPkVendas', 'SNIPER_PK_VENDAS', (v) => (Number.isInteger(Number(v)) && Number(v) >= 3 && Number(v) <= 100 ? Number(v) : null)],
  soShiny: ['sniperPkSoShiny', 'SNIPER_PK_SO_SHINY', (v) => (typeof v === 'boolean' ? v : null)],
  revender: ['sniperPkRevender', 'SNIPER_PK_REVENDER', (v) => (typeof v === 'boolean' ? v : null)],
  abaixo: ['sniperPkAbaixo', 'SNIPER_PK_ABAIXO', (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 10000 ? Number(v) : null)],
  margem: ['sniperPkMargem', 'SNIPER_PK_MARGEM', (v) => (Number(v) >= 0 && Number(v) <= 500 ? Number(v) : null)],
  revDias: ['sniperPkRevDias', 'SNIPER_PK_REV_DIAS', (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 30 ? Number(v) : null)],
};
function snMudar(pedido) {
  const mudou = [], erros = [];
  for (const [k, v] of Object.entries(pedido ?? {})) {
    const c = SN_CAMPOS[k]; if (!c) { erros.push(`${k}: campo desconhecido`); continue; }
    const val = c[2](v); if (val === null) { erros.push(`${k}: valor inválido`); continue; }
    if (CFG[c[0]] !== val) { mudou.push(`${c[1]}=${val === true ? 1 : val === false ? 0 : val}`); CFG[c[0]] = val; }
  }
  if (erros.length) return { ok: false, erros };
  if (mudou.length) {
    try { // grava no .env para valer depois de reiniciar (sem ler nem mostrar os outros valores)
      const p = join(AQUI, '.env'); let txt = existsSync(p) ? readFileSync(p, 'utf8') : '';
      for (const par of mudou) { const [chave] = par.split('='); const re = new RegExp(`^${chave}=.*$`, 'm'); txt = re.test(txt) ? txt.replace(re, par) : `${txt.replace(/\s*$/, '')}\n${par}\n`; }
      writeFileSync(p, txt);
    } catch (e) { log('sniper de pokemon: mudei, mas não consegui gravar no .env:', e.message); }
    log(`sniper de pokemon: ajustes pelo painel → ${mudou.join(', ')}`);
    if (mudou.some((m) => m.startsWith('SNIPER_PK='))) snEvento('modo', `modo agora: ${CFG.sniperPk === '1' ? 'COMPRANDO' : CFG.sniperPk === 'observar' ? 'só observando' : 'desligado'}`);
  }
  return { ok: true, mudou };
}
function snPainel() {
  const g = snDia();
  return { modo: CFG.sniperPk, seg: CFG.sniperPkSeg, max: CFG.sniperPkMax, dia: CFG.sniperPkDia, qtdDia: CFG.sniperPkQtdDia, reserva: CFG.sniperPkReserva, lucro: CFG.sniperPkLucro, vendas: CFG.sniperPkVendas, soShiny: CFG.sniperPkSoShiny,
    revender: CFG.sniperPkRevender, abaixo: CFG.sniperPkAbaixo, margem: CFG.sniperPkMargem, revDias: CFG.sniperPkRevDias, compras: (ACUM.snCompras ?? []).slice(-20).reverse(),
    hoje: { gasto: g.gasto, compras: g.compras, pendente: g.pendente }, comparaveis: SN.vendas.size, olhadas: SN.olhadas, vistos: SN.vistos, ultimaResposta: SN.ultimaResposta || null, eventos: SN.eventos };
}
const SEQ_SNIPER = 900_000;
// taxa de pokemon em Gemas é por faixa, como imposto de renda (shared/taxa-mercado.mjs FAIXAS_ORB; i18n aviso.v21Faixa1):
// 13% sobre os primeiros 500, 10% sobre o trecho até 5.000 e 7,5% sobre o que passa disso
function snLiquido(p) { const taxa = 0.13 * Math.min(p, 500) + 0.10 * Math.max(0, Math.min(p, 5000) - 500) + 0.075 * Math.max(0, p - 5000); return Math.floor(p - taxa); }
function snVendaOk(l) { return l?.tipo === 'pokemon' && l.moeda === 'orb' && l.ficha && l.bruto > 0; }
function snCarregarVendas() {
  if (SN.carregado) return; SN.carregado = true;
  try {
    const dir = join(AQUI, 'mercado'); const lim = Date.now() - 14 * 86400_000;
    for (const f of readdirSync(dir).filter((f) => f.startsWith('coleta-')).sort().slice(-200)) {
      try { for (const l of JSON.parse(readFileSync(join(dir, f), 'utf8')).respostas.filter((r) => r.aba === 'historicoGlobal').flatMap((r) => r.linhas ?? [])) if (snVendaOk(l) && l.em >= lim) SN.vendas.set(l.id, l); } catch {}
    }
    log(`sniper de pokemon: ${SN.vendas.size} vendas de pokemon em Gemas para comparar (14 dias)`);
  } catch (e) { log('sniper de pokemon: sem coletas do Mercado ainda:', e.message); }
}
// A nota pesa muito no preço do shiny (25/11, vendas reais: correlação nota × log(preço) de 0,8 em Larvitar, Numel e
// Snover; Numel nota 4,28 saiu por 380 e nota 5,6+ por 1.700–2.600). Então a referência é a mediana só das vendas
// de nota próxima (±SN_NOTA), e a espécie precisa ter SNIPER_PK_VENDAS vendas no total (liquidez).
const SN_NOTA = 0.3;
function snReferencia(f, { minPerto = 3, faixaNota = SN_NOTA } = {}) {
  const lim = Date.now() - 14 * 86400_000; const nv = f.level ?? 0; const folga = Math.max(20, nv * 0.25);
  const grupo = [...SN.vendas.values()].filter((l) => l.em >= lim && l.ficha.nome === f.nome && !!l.ficha.shiny === !!f.shiny && (l.ficha.potencia ?? 1) === (f.potencia ?? 1)
    && !!l.ficha.tmAoe === !!f.tmAoe && Math.abs((l.ficha.level ?? 0) - nv) <= folga);
  if (grupo.length < CFG.sniperPkVendas) return { ref: null, n: grupo.length, base: `só ${grupo.length} vendas da espécie` };
  const nota = Number(f.nota);
  const perto = Number.isFinite(nota) ? grupo.filter((l) => Math.abs((l.ficha.nota ?? 0) - nota) <= faixaNota).map((l) => l.bruto) : [];
  if (perto.length < minPerto) return { ref: null, n: perto.length, base: `só ${perto.length} vendas com nota parecida` };
  return { ref: mediana(perto), n: perto.length, base: `mediana de ${perto.length} vendas com nota ±${faixaNota} (de ${grupo.length} da espécie)` };
}
function snDia() {
  const dia = chaveDia();
  if (ACUM.sniperPk?.dia !== dia) ACUM.sniperPk = { dia, gasto: 0, compras: 0, pendente: 0 };
  return ACUM.sniperPk;
}
function cuidarDoSniperPk() {
  if (!['1', 'observar'].includes(CFG.sniperPk) || !S.eu || CFG.somenteLer || COLETA) return;
  snCarregarVendas();
  const agora = Date.now();
  // vendas novas a cada 10 min, para a referência não envelhecer
  if (agora - SN.ultimoHist > 10 * 60_000) { SN.ultimoHist = agora; for (let p = 0; p < 2; p++) enviar({ t: 'market.historicoGlobal', pagina: p, seq: SEQ_SNIPER + p, tipo: 'pokemon', moeda: 'orb', ...(CFG.sniperPkSoShiny ? { soShiny: 1 } : {}) }); }
  if (agora - SN.ultimaOlhada < CFG.sniperPkSeg * 1000) return;
  SN.ultimaOlhada = agora; SN.olhadas++;
  enviar({ t: 'market.listar', ...PEDIDO_POKEMON, moeda: 'orb', ordem: 'recentes', soShiny: CFG.sniperPkSoShiny });
}
function aoSniperPk(m) {
  if (!['1', 'observar'].includes(CFG.sniperPk) || !S.eu) return;
  if (m.aba === 'historicoGlobal') { const lim = Date.now() - 14 * 86400_000; for (const l of m.linhas ?? []) if (snVendaOk(l) && l.em >= lim) SN.vendas.set(l.id, l); return; }
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  SN.ultimaResposta = Date.now();
  for (const a of m.linhas ?? []) {
    if (a.tipo !== 'pokemon' || a.moeda !== 'orb' || a.estado !== 'aberto' || !a.ficha || SN.tentados.has(a.id)) continue;
    SN.vistos++;
    if (a.vendedorId === S.eu.id || a.vendedor === S.eu.nick) continue;
    const f = a.ficha; if (CFG.sniperPkSoShiny && !f.shiny) continue;
    SN.tentados.add(a.id);
    const { ref, n, base } = snReferencia(f);
    if (!ref || a.preco > CFG.sniperPkMax) continue;
    if (a.preco < ref * 0.1) continue; // isca: preço de fachada, costuma ser cancelado na retenção
    const liquido = snLiquido(ref);
    const ganho = liquido - a.preco;
    if (ganho < a.preco * CFG.sniperPkLucro / 100) continue;
    const desc = `${f.shiny ? 'shiny ' : ''}${f.nome} Nv${f.level} P${f.potencia ?? 1}${f.tmAoe ? ' AoE' : ''} nota ${f.nota}`;
    const motivo = `${fmt(a.preco)} Gemas; referência ${fmt(ref)} (${base}); revenda sem taxa ~${fmt(liquido)}, ganho ~${fmt(ganho)} (${Math.round(ganho / a.preco * 100)}%)`;
    const G = snDia(); const saldo = Number(S.eu.orbs) || 0;
    // conta também as compras esperando o sorteio: dois anúncios liberando juntos furavam o limite (25/11: 4 compras com limite 3)
    const barra = G.compras + (G.pendQtd ?? 0) >= CFG.sniperPkQtdDia ? `já fez ${G.compras} compras hoje${G.pendQtd ? ` (+${G.pendQtd} no sorteio)` : ''}`
      : G.gasto + G.pendente + a.preco > CFG.sniperPkDia ? `passaria do orçamento do dia (${fmt(G.gasto + G.pendente)}/${fmt(CFG.sniperPkDia)})`
      : saldo - G.pendente - a.preco < CFG.sniperPkReserva ? `deixaria menos de ${fmt(CFG.sniperPkReserva)} Gemas (saldo ${fmt(saldo)})` : null;
    const info = { preco: a.preco, ref, ganho, pct: Math.round(ganho / a.preco * 100), motivo };
    if (CFG.sniperPk === 'observar' || barra) { log(`sniper de pokemon: ${CFG.sniperPk === 'observar' ? 'compraria' : 'não compro (' + barra + ')'} ${desc} — ${motivo}`); snEvento(CFG.sniperPk === 'observar' ? 'compraria' : 'barrado', desc, { ...info, barra }); continue; }
    G.pendente += a.preco; G.pendQtd = (G.pendQtd ?? 0) + 1;
    const solta = () => { const g = snDia(); g.pendente = Math.max(0, g.pendente - a.preco); g.pendQtd = Math.max(0, (g.pendQtd ?? 0) - 1); };
    const espera = Math.max(0, (a.compravelEm ?? 0) - Date.now() + 300); // pede logo depois de liberar, dentro dos 3 s do sorteio
    log(`sniper de pokemon: vou pedir ${desc} em ${Math.round(espera / 1000)} s — ${motivo}`);
    snEvento('pedindo', desc, { ...info, libera: a.compravelEm ?? null });
    setTimeout(() => {
      const saldoAntes = Number(S.eu?.orbs) || 0;
      // confere o saldo de novo na hora de pedir: em 2 min de retenção ele pode ter mudado (outra compra, saque)
      const outros = snDia().pendente - a.preco;
      if (saldoAntes - Math.max(0, outros) - a.preco < CFG.sniperPkReserva) {
        solta();
        log(`sniper de pokemon: desisti de ${desc} — saldo ${fmt(saldoAntes)} Gemas não cobre ${fmt(a.preco)} (reserva ${fmt(CFG.sniperPkReserva)})`);
        snEvento('barrado', desc, { ...info, barra: `saldo ${fmt(saldoAntes)} não cobre` });
        return;
      }
      S.depurarAte = Date.now() + 20_000;
      const espero = { nome: f.nome, nivel: f.level, preco: a.preco, ok: false };
      SN.aguardando = [...(SN.aguardando ?? []), espero];
      enviar({ t: 'market.comprar', id: a.id, qtd: 1, preco: a.preco, moeda: 'orb', sorteioUi: 1 }, { urgente: true });
      // confirma pelo aviso do jogo (marketComprado, um por compra): no sorteio quem perde não paga, e o anúncio
      // pode ter sido cancelado na retenção. O saldo não serve: duas compras juntas confundem a conta.
      setTimeout(() => {
        solta(); SN.aguardando = (SN.aguardando ?? []).filter((x) => x !== espero);
        const g = snDia(); const pagou = espero.ok;
        if (pagou) { g.gasto += a.preco; g.compras += 1; snEvento('comprou', desc, info);
          (ACUM.snCompras ??= []).push({ pokemonId: a.pokemonId ?? f.id ?? null, nome: f.nome, nivel: f.level, potencia: f.potencia ?? 1, shiny: !!f.shiny, aoe: !!f.tmAoe, nota: f.nota, custo: a.preco, ref, em: Date.now(), estado: 'comprado', tentativas: 0 }); avisarShiny('mercado', `🛒 Sniper comprou ${desc}`, `${motivo}. Anunciar para revender é com você.`); }
        else { log(`sniper de pokemon: não levei ${desc} (sorteio perdido, cancelado ou preço mudou)`); snEvento('perdeu', desc, info); }
      }, 20_000);
    }, espera);
  }
}

// ---------- Revenda do que o sniper comprou (SNIPER_PK_REVENDER=1) ----------
// Preço: SNIPER_PK_ABAIXO Gemas abaixo do menor entre a média das vendas parecidas e o anúncio parecido mais barato,
// sem descer do piso (o que pagou + SNIPER_PK_MARGEM%, já descontada a taxa do Mercado: 13% até 500, 10% até 5.000).
// Só mexe em pokemon que o próprio sniper comprou (ACUM.snCompras).
function snPiso(custo) {
  const alvo = Math.ceil(custo * (1 + CFG.sniperPkMargem / 100));
  let p = Math.max(1, alvo); while (snLiquido(p) < alvo) p++;
  return p;
}
function snAcharPk(r) {
  if (r.pokemonId && S.pokemons.has(r.pokemonId)) return S.pokemons.get(r.pokemonId);
  const p = [...S.pokemons.values()].find((x) => x.nome === r.nome && !!x.shiny === r.shiny && x.level === r.nivel && (r.nota == null || Math.abs((x.nota ?? 0) - r.nota) < 0.002));
  if (p) r.pokemonId = p.id;
  return p ?? null;
}
const SNR = { pedido: null };
function cuidarDaRevenda() {
  if (!CFG.sniperPkRevender || !S.eu || CFG.somenteLer || COLETA) return;
  const agora = Date.now(); const lista = ACUM.snCompras ?? [];
  if (SNR.pedido) { // sem resposta em 60 s: tenta de novo depois
    if (agora - SNR.pedido.em < 60_000) return;
    const r = lista[SNR.pedido.idx]; if (r && ['consultando', 'anunciando'].includes(r.estado)) { r.estado = 'comprado'; r.obs = 'sem resposta do Mercado'; }
    SNR.pedido = null;
  }
  if (agora - (SNR.ultimo ?? 0) < 60_000) return;
  const idx = lista.findIndex((r) => r.estado === 'comprado' && (r.tentativas ?? 0) < 3);
  if (idx < 0) return;
  const r = lista[idx]; const pk = snAcharPk(r);
  if (!pk) { r.obs = 'não achei o pokemon na conta'; return; }
  if (pk.id === S.eu.activeId) { r.obs = 'é o pokemon ativo; não anuncio'; return; }
  SNR.ultimo = agora; SNR.pedido = { idx, em: agora }; r.estado = 'consultando';
  enviar({ t: 'market.listar', ...PEDIDO_POKEMON, moeda: 'orb', ordem: 'baratos', busca: r.nome, soShiny: r.shiny });
}
function aoRevendaVitrine(m) {
  if (!SNR.pedido || m.ordem !== 'baratos') return false;
  const r = (ACUM.snCompras ?? [])[SNR.pedido.idx]; if (!r || r.estado !== 'consultando') return false;
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  const folga = Math.max(20, r.nivel * 0.25);
  const conc = (m.linhas ?? []).filter((a) => a.tipo === 'pokemon' && a.moeda === 'orb' && a.estado === 'aberto' && a.ficha && a.vendedorId !== S.eu.id && a.ficha.nome === r.nome
    && !!a.ficha.shiny === r.shiny && (a.ficha.potencia ?? 1) === r.potencia && !!a.ficha.tmAoe === r.aoe && Math.abs((a.ficha.level ?? 0) - r.nivel) <= folga
    // concorrente é quem tem nota parecida ou melhor; um de nota bem pior mais barato não disputa o mesmo comprador
    && (r.nota == null || (a.ficha.nota ?? 0) >= r.nota - SN_NOTA)).map((a) => a.preco);
  const menor = conc.length ? Math.min(...conc) : null;
  const fichaR = { nome: r.nome, shiny: r.shiny, potencia: r.potencia, tmAoe: r.aoe, level: r.nivel, nota: r.nota };
  const media = snReferencia(fichaR, { minPerto: 2 }).ref ?? snReferencia(fichaR, { minPerto: 2, faixaNota: 0.5 }).ref ?? null;
  const base = Math.min(media ?? Infinity, menor ?? Infinity);
  const piso = snPiso(r.custo);
  // sem média nem concorrente: anuncia no piso (melhor girar o pokemon do que deixar parado)
  const preco = Number.isFinite(base) ? Math.max(piso, Math.round(base - CFG.sniperPkAbaixo)) : piso;
  const pensao = 100_000 * CFG.sniperPkRevDias;
  if ((S.eu.gold ?? 0) < pensao * 2) { r.estado = 'comprado'; r.obs = `ouro curto para a pensão (${fmt(pensao)})`; SNR.pedido = null; return true; }
  r.estado = 'anunciando'; r.preco = preco; r.media = media; r.menor = menor; r.piso = piso; r.obs = null; SNR.pedido.em = Date.now();
  const txt = `${r.nome} Nv${r.nivel}${r.shiny ? ' shiny' : ''} por ${fmt(preco)} Gemas (pagou ${fmt(r.custo)}; média ${media ? fmt(media) : '?'}, mais barato ${menor ? fmt(menor) : 'nenhum'}, piso ${fmt(piso)}; recebe ~${fmt(snLiquido(preco))}) por ${CFG.sniperPkRevDias} dia(s)`;
  log(`revenda: anunciando ${txt}${preco > base ? ' — acima do mercado, o piso manda' : ''}`);
  snEvento('anunciando', `${r.nome} Nv${r.nivel}`, { preco, ref: media, ganho: snLiquido(preco) - r.custo, pct: Math.round((snLiquido(preco) - r.custo) / r.custo * 100), motivo: txt });
  S.depurarAte = Date.now() + 20_000;
  enviar({ t: 'market.criar', tipo: 'pokemon', itemId: null, pokemonId: r.pokemonId, casaId: null, bicicletaId: null, qtd: 1, preco, moeda: 'orb', dias: CFG.sniperPkRevDias });
  return true;
}
function aoRevendaEvento(ev) {
  if (ev.k === 'marketComprado' && typeof ev.descricao === 'string') {
    const x = (SN.aguardando ?? []).find((y) => !y.ok && ev.descricao.startsWith(`${y.nome} Nv ${y.nivel}`) && (ev.total == null || Number(ev.total) === y.preco));
    if (x) x.ok = true;
  }
  const lista = ACUM.snCompras ?? []; if (!lista.length) return;
  const casa = (r) => typeof ev.descricao === 'string' && ev.descricao.startsWith(`${r.nome} Nv ${r.nivel}`);
  if (ev.k === 'marketCriado' && SNR.pedido) {
    const r = lista[SNR.pedido.idx]; if (r && r.estado === 'anunciando' && (casa(r) || !ev.descricao)) { r.estado = 'anunciado'; r.anuncioEm = Date.now(); SNR.pedido = null; log(`revenda: anúncio criado — ${ev.descricao ?? r.nome}`); }
  } else if (ev.k === 'marketVendido' && ev.moeda === 'orb') {
    const r = lista.find((x) => x.estado === 'anunciado' && casa(x)); if (!r) return;
    r.estado = 'vendido'; r.recebido = ev.valor ?? snLiquido(r.preco); r.lucro = r.recebido - r.custo; r.vendidoEm = Date.now();
    snEvento('vendeu', `${r.nome} Nv${r.nivel}`, { preco: r.preco, ref: r.media, ganho: r.lucro, pct: Math.round(r.lucro / r.custo * 100), motivo: `pagou ${r.custo}, recebeu ${r.recebido}` });
    avisarShiny('mercado', `💸 Revenda: vendeu ${r.nome} Nv${r.nivel}`, `Pagou ${r.custo} Gemas, recebeu ${r.recebido}. Lucro ${r.lucro} Gemas.`);
  } else if (/^marketExpirou|^marketDevolvido/.test(ev.k ?? '')) {
    const r = lista.find((x) => x.estado === 'anunciado' && casa(x)); if (!r) return;
    r.tentativas = (r.tentativas ?? 0) + 1; r.estado = r.tentativas >= 3 ? 'parado' : 'comprado'; r.obs = `${ev.k}: voltou sem vender`;
    log(`revenda: ${r.nome} Nv${r.nivel} voltou sem vender (${r.tentativas}ª vez)${r.estado === 'parado' ? '; paro de anunciar este' : ''}`);
  }
}
function aoRevendaErro(m) {
  if (!SNR.pedido) return;
  const r = (ACUM.snCompras ?? [])[SNR.pedido.idx]; if (!r || r.estado !== 'anunciando') return;
  r.estado = 'comprado'; r.tentativas = (r.tentativas ?? 0) + 1; r.obs = 'o Mercado recusou: ' + JSON.stringify(m).slice(0, 160); SNR.pedido = null;
  log(`revenda: o Mercado recusou o anúncio de ${r.nome} Nv${r.nivel} — ${JSON.stringify(m).slice(0, 200)}`);
}

// ---------- Prey: a cartela 1 é grátis uma vez por dia (vira às 18h de Brasília) ----------
const diaDoPrey = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
function cuidarDoPrey() {
  if (!CFG.prey || !S.eu || CFG.somenteLer) return;
  const agora = Date.now(); if (agora - (S.ultimoPrey ?? 0) < 60_000) return; S.ultimoPrey = agora;
  const dia = diaDoPrey();
  const doEstado = S.eu.automation?.prey?.dia === dia ? S.eu.automation.prey.cartelas?.[0] : null;
  const c = (S.preyCartela?.dia === dia ? S.preyCartela.c : null) ?? doEstado;
  const lista = Array.isArray(c?.lista) ? c.lista : [];
  if (!lista.length) {
    if (S.preyRoletouDia === dia) return;
    S.preyRoletouDia = dia; S.depurarAte = agora + 15_000;
    log('Prey: roletando a cartela grátis do dia');
    return enviar({ t: 'prey.roletar', cartela: 0, categoria: 'tudo', dia, n: Number(c?.n?.[0]) || 0 });
  }
  if (c.pk != null || S.preyEscolheuDia === dia) return;
  // pontua cada opção: spawn na hunt atual vale muito; nas hunts do degrau atual, um pouco
  const atual = S.hunts.find((h) => h.slug === S.eu.huntSlug);
  const mesmoNivel = S.hunts.filter((h) => atual && h.nivel === atual.nivel);
  const pontos = (id, hs) => hs.reduce((t, h) => t + (h.especies ?? []).filter((e) => Number(e.pokeId) === Number(id)).reduce((u, e) => u + (e.pontos ?? 1), 0), 0);
  const nota = (id) => 100 * pontos(id, atual ? [atual] : []) + pontos(id, mesmoNivel);
  const pk = [...lista].sort((x, y) => nota(y) - nota(x))[0];
  S.preyEscolheuDia = dia; S.depurarAte = agora + 15_000;
  log(`Prey: opções ${lista.map((id) => `${ESPECIES.get(Number(id))?.nome ?? id}(${nota(id)})`).join(', ')} · bônus ${c.bonus} ${c.est}★ → ${ESPECIES.get(Number(pk))?.nome ?? pk}`);
  enviar({ t: 'prey.escolher', cartela: 0, dia, pk });
}

// ---------- PvP Ranqueado: fila automática do servidor (VIP) ----------
function cuidarDoPvp() {
  if (!CFG.pvp || !S.eu || CFG.somenteLer) return;
  const agora = Date.now(); if (agora - (S.ultimoPvp ?? 0) < 10 * 60_000) return; S.ultimoPvp = agora;
  if ((S.eu.level ?? 0) < 150) return;
  enviar({ t: 'pvp.info', semLadder: 1 });
}

function cuidarDoPasse() {
  const agora = Date.now();
  if (agora - S.ultimoPasse < 6 * 3600_000) return;
  S.ultimoPasse = agora;
  enviar({ t: 'passe.resgatar' });
}

function pacoteAuto(a, patch) {
  const pacote = { t: 'auto.set' };
  for (const k of ['autoBallAteCapturar', 'autoBallSemParar', 'autoBall', 'ballIds', 'autoRevive', 'reviveIds', 'autoPotion', 'potionIds', 'hpLimiar', 'autoVoltarHunt', 'pvpAutoFila']) {
    if (Object.hasOwn(a, k)) pacote[k] = a[k];
  }
  return Object.assign(pacote, patch);
}

function garantirAutomacoes() {
  const a = S.eu?.automation;
  if (!a) return;
  // Auto Venda do Depot: vende ao NPC o capturado comum; o jogo nunca vende
  // shiny, lendário, mega, P5, inicial nem equipe (coleção padrão guarda P4+).
  if (CFG.timeForte && a.autoVendaDepot === true && Date.now() - (S.ultimoAutoVenda ?? 0) > 60_000) {
    S.ultimoAutoVenda = Date.now(); log('time forte: desligando a Auto Venda; as capturas vão para o Depot e o bot escolhe o que fica');
    return enviar({ t: 'shop.autoVendaDepot', ativo: false });
  }
  if (CFG.autoVenda && !CFG.timeForte && a.autoVendaDepot !== true && Date.now() - (S.ultimoAutoVenda ?? 0) > 120_000) {
    S.ultimoAutoVenda = Date.now();
    log('ligando Auto Venda do Depot (shiny, lendário e P4+ ficam guardados)');
    enviar({ t: 'shop.autoVendaDepot', ativo: true });
  }
  // Auto Coleção: além do padrão do jogo (lendário, shiny, P4+), guarda nota >= COLECAO_NOTA_MIN
  if ((CFG.colecaoNota || CFG.timeForte) && Date.now() - (S.ultimaColecao ?? 0) > (CFG.timeForte && !colecaoProtege() ? 30_000 : 300_000)) {
    const atual = a.autoColecao ?? {};
    const min = notaDaColecao();
    if (atual.nota?.on !== true || Number(atual.nota?.min) !== min || (CFG.timeForte && !colecaoProtege())) {
      S.ultimaColecao = Date.now();
      const regra = { ...atual, nota: { on: true, min }, ...(CFG.timeForte ? { shiny: { on: true }, lendario: { on: true }, potencial: { on: true } } : {}) };
      log(`Auto Coleção: guardar capturas com nota >= ${min}${CFG.timeForte ? ' (também quem alcança isso evoluindo)' : ''}, além de lendário, shiny e P4+`);
      enviar({ t: 'shop.autoColecao', regra });
      return;
    }
  }
  // VIP: o servidor lança até capturar, com as bolas da lista (melhores primeiro)
  const vip = !!S.eu.loja?.vip;
  const ballIdsVip = [...S.bolas].filter((b) => (S.eu.balls?.[b.id] ?? 0) > 0).sort((x, y) => y.catchRate - x.catchRate).map((b) => b.id);
  const querAutoBall = vip && CFG.modoCaptura !== 'nao' && ballIdsVip.length > 0;
  const ballIdsMudou = querAutoBall && JSON.stringify(a.ballIds ?? []) !== JSON.stringify(ballIdsVip);
  if (querAutoBall && (!a.autoBallAteCapturar || ballIdsMudou) && Date.now() - (S.ultimoAutoBall ?? 0) > 60_000) {
    S.ultimoAutoBall = Date.now();
    log(`VIP: Lançar até Capturar ligado no servidor (bolas ${ballIdsVip.join(',')})`);
    enviar(pacoteAuto(a, { autoBallAteCapturar: true, autoBallSemParar: false, ballIds: ballIdsVip }));
    return;
  }
  // poção: a maior que não desperdiça (cura <= HP máx do ativo) primeiro, depois as maiores, depois as menores
  const mhp = ativo()?.maxHp ?? 100;
  const cabe = pocaoCerta(mhp);
  const ordem = [cabe.id, ...POCOES.filter((p) => p.cura > cabe.cura).map((p) => p.id), ...[...POCOES].reverse().filter((p) => p.cura < cabe.cura).map((p) => p.id), 70070];
  const limiarOk = Math.abs(Number(a.hpLimiar ?? 0) - CFG.hpLimiar) < 0.001;
  const ordemOk = JSON.stringify(a.potionIds ?? []) === JSON.stringify(ordem);
  if ((!limiarOk || !ordemOk || !a.autoPotion) && Date.now() - (S.ultimoAutoPocao ?? 0) > 60_000) {
    S.ultimoAutoPocao = Date.now();
    log(`poções: usar abaixo de ${Math.round(CFG.hpLimiar * 100)}% do HP, nesta ordem: ${ordem.join(', ')}`);
    enviar(pacoteAuto(a, { autoPotion: true, hpLimiar: CFG.hpLimiar, potionIds: ordem }));
    return;
  }
  if (S.fuga) return; // saindo de hunt que mata: revive e voltar-à-hunt ficam desligados de propósito
  if (a.autoRevive && a.autoPotion && a.autoVoltarHunt) return;
  const pacote = pacoteAuto(a, { autoRevive: true, autoPotion: true, autoVoltarHunt: true });
  log('religando automações grátis (revive, poção, voltar à hunt)');
  enviar(pacote);
}

function resumo() {
  const e = S.eu;
  if (!e) return;
  const horas = Math.max(1 / 60, onlineMs() / 3600_000);
  const xpAgora = xpAtualDe(e);
  const dxp = xpAgora - (S.stats.xp0 ?? xpAgora);
  const douro = (e.gold ?? 0) - (S.stats.ouro0 ?? 0) - (S.stats.ouroExtra ?? 0);
  const a = ativo();
  log(`Nv ${e.level} (${Math.floor(progressoNivel(e) * 100)}%) · ouro ${e.gold} · hunt ${e.huntSlug ?? '-'}${e.noCentro ? ' [Centro]' : ''}` +
    ` · ativo ${a ? `${a.nome} Nv${a.level} ${a.hp}/${a.maxHp}` : '-'}` +
    ` · ${Math.round(dxp / horas)} xp/h · ${Math.round(douro / horas)} ouro/h líquido` +
    ` · abates ${S.stats.abates} · capturas ${S.stats.capturas}/${S.stats.bolas} bolas (servidor confirmou ${S.stats.bolasServidor ?? 0}) · desmaios ${S.stats.desmaios}`);
}

// avisa quando um resgate de live cai (o "válido até" do bônus avança)
function vigiarLives() {
  for (const k of ['twitch', 'kick']) {
    const x = S.eu?.[k];
    if (!x) continue;
    for (const tp of ['xp', 'captura', 'shiny']) {
      const ate = Number(x.bonus?.[tp]) || 0;
      const chave = `${k}:${tp}`;
      const antes = S.bonusVisto?.[chave];
      S.bonusVisto ??= {};
      if (antes !== undefined && ate > antes + 1000) log(`${k}: bônus ${tp} +${x.pct ?? 15}% valendo por mais ${Math.round((ate - Math.max(antes, Date.now())) / 60000)} min (total ${Math.round((ate - Date.now()) / 60000)} min)`);
      S.bonusVisto[chave] = ate;
    }
  }
}

// erro numa rotina não derruba as outras nem o bot: vai para o bot.log (o iniciar-oculto.vbs descarta o stderr)
const ERROS_VISTOS = new Map();
function logErro(onde, e) {
  const msg = `${onde}: ${e?.stack ?? e}`; const chave = msg.slice(0, 200);
  if (Date.now() - (ERROS_VISTOS.get(chave) ?? 0) < 10 * 60_000) return; // o mesmo erro, no máximo a cada 10 min
  ERROS_VISTOS.set(chave, Date.now());
  log('ERRO em', msg.split('\n').slice(0, 4).join(' | '));
}
process.on('uncaughtException', (e) => logErro('não tratado', e));
process.on('unhandledRejection', (e) => logErro('promessa', e));
function tique() {
  if (!S.welcome || !S.eu) return;
  const rodar = (nome, f) => { try { f(); } catch (e) { logErro(nome, e); } };
  rodar('lives', vigiarLives);
  rodar('rotina', cuidarDaRotina);
  rodar('bosses', cuidarDosBosses);
  rodar('raid', cuidarDaRaid);
  if (CFG.radar && Date.now() - (S.ultimoRadar ?? 0) > 6 * 3600_000) { S.ultimoRadar = Date.now(); carregarRadar(); }
  rodar('vendas', conciliarSaltos);
  rodar('medição', medirDegrau);
  if (Date.now() - (S.ultimaColeta ?? 0) > 6 * 3600_000 && Date.now() - S.conectadoEm > 30_000) { S.ultimaColeta = Date.now(); rodar('mercado', () => coletarMercado('automática')); }
  rodar('automações', garantirAutomacoes);
  rodar('equipe', cuidarDaEquipe);
  rodar('evolução', cuidarDaEvolucao);
  rodar('hunt', cuidarDaHunt);
  rodar('estoque', cuidarDoEstoque);
  rodar('passe', cuidarDoPasse);
  rodar('sacrifício', cuidarDoSacrificio);
  rodar('venda dos fracos', cuidarDaVenda);
  rodar('prey', cuidarDoPrey);
  rodar('mercado ao vivo', cuidarDoMercadoVivo);
  rodar('sniper de pokemon', cuidarDoSniperPk);
  rodar('revenda', cuidarDaRevenda);
  rodar('preços do patrimônio', cuidarDosPrecos);
  rodar('top catch', cuidarDoTopCatch);
  rodar('pvp', cuidarDoPvp);
}

// ---------- mensagens do servidor ----------
// Só para o painel: o servidor não manda mais o campo (mensagem 'campo'); os selvagens em luta saem dos eventos de batalha.
function vistaBatalha(ev) {
  const v = (S.vista ??= new Map()), agora = Date.now();
  for (const [k, x] of v) if (x.morto ? agora - x.fim > 900 : agora - x.visto > 20_000) v.delete(k);
  if (ev.k === 'ataque' && ev.por === 'jogador' && ev.slot != null) {
    const x = v.get(ev.slot) ?? { slot: ev.slot, mhp: Math.max(1, (ev.hpAlvo ?? 0) + (ev.dano ?? 0)) };
    x.hp = ev.hpAlvo ?? x.hp; x.mhp = Math.max(x.mhp, x.hp); x.visto = agora; v.set(ev.slot, x);
  } else if (ev.k === 'ataque' && ev.por === 'selvagem' && ev.slot != null && !v.has(ev.slot)) {
    v.set(ev.slot, { slot: ev.slot, hp: 1, mhp: 1, visto: agora });
  } else if (ev.k === 'morte' && ev.quem === 'selvagem' && ev.slot != null) {
    const x = v.get(ev.slot) ?? { slot: ev.slot, mhp: 1 };
    Object.assign(x, { hp: 0, morto: true, fim: agora, visto: agora, nome: ev.nome ?? x.nome }); v.set(ev.slot, x);
  } else if (ev.k === 'fugiu') { for (const [k, x] of v) if (!x.morto) v.delete(k); }
}
function aoEvento(ev) {
  vistaBatalha(ev);
  if (Date.now() < (S.depurarAte ?? 0) && !['dano','golpe','abate','bola','xp','spawn','cura','pocao','morteSelvagem','ataque'].includes(ev.k)) log('[depurar ev]', JSON.stringify(ev).slice(0, 300));
  if (/^market/.test(ev.k ?? '')) { try { aoRevendaEvento(ev); } catch (e) { logErro('revenda', e); } }
  if (ev.k === 'marketComprado') log(`Mercado: comprado ${ev.descricao ?? '?'} por ${ev.total ?? '?'} ${ev.moeda === 'orb' ? 'Gemas' : ev.moeda ?? ''}`);
  if (ev.k === 'preyRoletou' || ev.k === 'preyEscolheu') { S.preyCartela = { dia: diaDoPrey(), c: ev.c }; if (ev.k === 'preyEscolheu') log(`Prey: escolhido ${ESPECIES.get(Number(ev.c?.pk))?.nome ?? ev.c?.pk} · bônus ${ev.c?.bonus} ${ev.c?.est}★`); }
  switch (ev.k) {
    case 'morte':
      if (ev.quem === 'selvagem') {
        S.stats.abates++; ACUM.abates++; hoje().abates++; huntSessao().abates++;
        for (const d of ev.drops ?? []) {
          const nome = d.nome ?? `item ${d.itemId}`;
          S.drops.set(nome, (S.drops.get(nome) ?? 0) + (Number(d.qtd) || 1));
          ACUM.drops[nome] = (ACUM.drops[nome] ?? 0) + (Number(d.qtd) || 1);
          hoje().drops[nome] = (hoje().drops[nome] ?? 0) + (Number(d.qtd) || 1);
          if (!/potion|ball/i.test(nome) && !S.dropsVistos.has(nome)) { S.dropsVistos.add(nome); log(`drop novo: ${nome}`); }
        }
      } else { S.stats.desmaios++; ACUM.desmaios++; hoje().desmaios++; S.mortes.push(Date.now()); (S.mortesHunt ??= []).push([Date.now(), S.eu?.huntSlug]); S.mortesHunt = S.mortesHunt.slice(-30); ACUM.mortesRecentes = S.mortes.slice(-20); log(`desmaiou! (${S.eu?.huntSlug ?? '?'})`); }
      break;
    case 'capturado':
      S.stats.capturas++; ACUM.capturas++; hoje().capturas++; if (ev.pokemon?.shiny) { ACUM.shinyCapturados++; hoje().shiny++; }
      S.capturados.unshift({ em: Date.now(), ...ev.pokemon }); S.capturados.length = Math.min(S.capturados.length, 30);
      log(`capturou ${ev.pokemon?.shiny ? '✨ ' : ''}${ev.pokemon?.nome} Nv${ev.pokemon?.level} Q${ev.pokemon?.quality}${ev.vendidoAuto ? ` · Auto Venda ${Number(ev.vendidoAuto).toLocaleString('pt-BR')} de ouro` : ''}`);
      if (Number(ev.vendidoAuto) > 0) { S.ultimoVendidoAuto = { valor: Number(ev.vendidoAuto), em: Date.now() }; registrarVenda(Number(ev.vendidoAuto), 'auto'); }
      if (ev.pokemon?.shiny) {
        const p = precoShiny(ev.pokemon.nome);
        const txtPreco = p.sugerido ? `Preço sugerido ~${p.sugerido.toLocaleString('pt-BR')} Gemas (≈ US$ ${p.usd}), ${p.base}.` : 'Sem histórico de preço para essa espécie.';
        avisarShiny('capturado', `✨ SHINY CAPTURADO: ${ev.pokemon.nome} Nv${ev.pokemon.level}`, `Qualidade ${ev.pokemon.quality ?? '?'} · guardado na coleção. ${txtPreco}`, { ...ev.pokemon, preco: p });
      }
      break;
    case 'fugiu':
      if (ev.shiny) { ACUM.shinyEscapou = (ACUM.shinyEscapou ?? 0) + 1; hoje().shinyEscapou = (hoje().shinyEscapou ?? 0) + 1;
        avisarShiny('escapou', `✨ Shiny escapou: ${ev.nome ?? '?'} Nv${ev.level ?? '?'}`, `A bola${S.ultimaBola ? ' ' + ({ 1: 'Poke', 2: 'Great', 3: 'Super', 4: 'Ultra', 5: 'Beast' }[S.ultimaBola] ?? S.ultimaBola) : ''} não segurou.`, { nome: ev.nome, level: ev.level }); }
      break;
    case 'bola': {
      S.ultimaBola = ev.ballId;
      S.stats.bolasServidor = (S.stats.bolasServidor ?? 0) + 1; if (ev.sucesso) S.stats.bolasSucesso = (S.stats.bolasSucesso ?? 0) + 1;
      ACUM.bolasConfirmadas++; hoje().bolas++; if (ev.sucesso) ACUM.bolasSucesso++;
      const pb = (ACUM.porBola[ev.ballId ?? '?'] ??= { lancadas: 0, sucesso: 0 }); pb.lancadas++; if (ev.sucesso) pb.sucesso++;
      break;
    }
    case 'bossEntrou': log(`boss: entrou em ${ev.nome} Nv${ev.nivel ?? '?'}${ev.auto ? ' (auto)' : ''}`); break;
    case 'bossMorto': { const d = (ev.drops ?? []).map((x) => `${x.qtd ?? 1}× ${x.nome ?? x.itemId}`).join(', '); log(`boss: venceu ${ev.nome}${d ? ` — drops: ${d}` : ''}`); for (const x of ev.drops ?? []) { const n = x.nome ?? `item ${x.itemId}`; ACUM.drops[n] = (ACUM.drops[n] ?? 0) + (Number(x.qtd) || 1); } break; }
    case 'bossPerdeu': log(`boss: perdeu para ${ev.nome}`); break;
    case 'levelup': log('level up:', ev.quem ?? ''); if (ev.quem === 'treinador' && ev.level % 50 === 0) aviso('nivel', `Treinador chegou ao Nv ${ev.level}`, '', true); break;
    case 'evolucao': log('evolução!', JSON.stringify(ev).slice(0, 160)); break;
    case 'hunt': if (ev.trocaLivreEm) S.eu.trocaLivreEm = ev.trocaLivreEm; break;
    case 'autoHuntSemItens': log('sem itens para a automação — vai comprar'); S.ultimaCompra = 0; break;
    case 'centro': log('foi ao Centro:', ev.motivo ?? ''); break;
    case 'venda': { // venda ao NPC (Depot); a da Auto Venda já veio no 'capturado'
      const v = Number(ev.ganho) || 0; const u = S.ultimoVendidoAuto;
      if (!(u && u.valor === v && Date.now() - u.em < 3000)) registrarVenda(v, 'npc');
      break;
    }
  }
}

// ---------- vendas da Auto Venda × prêmios ----------
// Quase todo o ouro vem da captura vendida ao NPC (Pinsir Nv100 = 120 mil × qualidade). Antes ela caía como
// "prêmio" e sumia do ouro/h, do histórico e da medição de hunt no modo economia.
S.saltos = []; S.vendas = []; S.vendasTotal = 0;
function registrarVenda(valor, origem) {
  if (!(valor > 0)) return;
  S.vendasTotal += valor; ACUM.vendas = (ACUM.vendas ?? 0) + valor; hoje().vendas = (hoje().vendas ?? 0) + valor;
  S.vendas.push({ valor, em: Date.now(), origem });
  conciliarSaltos();
}
function conciliarSaltos() {
  const agora = Date.now();
  // um salto é explicado pelas vendas dos 5 s em volta (a diferença é o ouro dos abates do mesmo pacote)
  for (const s of [...S.saltos]) {
    const perto = S.vendas.filter((v) => Math.abs(v.em - s.em) <= 5000);
    const soma = perto.reduce((t, v) => t + v.valor, 0);
    if (soma > 0 && s.valor - soma < CFG.ouroSaltoMin) {
      S.saltos.splice(S.saltos.indexOf(s), 1);
      for (const v of perto) S.vendas.splice(S.vendas.indexOf(v), 1);
      log(`venda da captura +${s.valor.toLocaleString('pt-BR')} de ouro (conta no farm)`);
    } else if (agora - s.em > 5000) {
      S.saltos.splice(S.saltos.indexOf(s), 1);
      S.stats.ouroExtra = (S.stats.ouroExtra ?? 0) + s.valor; hoje().ouroExtra += s.valor;
      log(`ouro extra +${s.valor.toLocaleString('pt-BR')} (prêmio; não conta no ouro/h)`);
    }
  }
  S.vendas = S.vendas.filter((v) => agora - v.em <= 10_000);
}

function depurar(o) { if (process.env.DEBUG_MSGS === '1') { try { appendFileSync(join(AQUI, 'debug.log'), `[${new Date().toLocaleTimeString('pt-BR')}] ${JSON.stringify(o).slice(0, 700)}\n`); } catch {} } }
function aoMensagem(m) {
  if (!['campo', 'chat', 'pong', 'estado', 'vivo', 'campo.init'].includes(m.t)) depurar(m.t === 'batalha' ? { t: 'batalha', ev: (m.ev ?? []).filter((e) => !['ataque', 'spawn', 'bola'].includes(e.k) && !(e.k === 'morte' && e.quem === 'selvagem')) } : m);
  if (m.t === 'estado' && m.estado && ('pokemons' in m.estado || 'pkMud' in m.estado || 'activeId' in m.estado)) depurar({ t: 'estado(equipe)', activeId: m.estado.activeId, pkMud: (m.estado.pkMud ?? []).map((p) => [p.nome, p.slot, p.hp]), pkFora: m.estado.pkFora });
  if (m.t === 'market' && m.aba === 'cotacaoLote') aoCotacao(m);
  if (m.t === 'market' && m.aba === 'medias' && m.medias) S.precos = { em: Date.now(), medias: m.medias, dias: m.dias ?? null };
  if (m.t === 'market' && (m.aba === 'medias' || m.aba === 'itens')) aoMercadoVivo(m);
  if (m.t === 'market' && m.aba === 'vitrine') { try { aoRevendaVitrine(m); } catch (e) { logErro('revenda', e); } }
  if (m.t === 'market' && (m.aba === 'vitrine' || m.aba === 'historicoGlobal')) { try { aoSniperPk(m); } catch (e) { logErro('sniper de pokemon', e); } }
  if (m.t === 'erro' && /market|mercado|anunci|pokemon/i.test(JSON.stringify(m))) { try { aoRevendaErro(m); } catch (e) { logErro('revenda', e); } }
  if (COLETA && (m.t === 'market' || m.t === 'economia' || m.t === 'orbs' || (m.t === 'erro' && /market|mercado/i.test(JSON.stringify(m))))) COLETA.respostas.push(m);
  if (Date.now() < (S.depurarAte ?? 0) && !['campo','campo.init','batalha','delta','pong','market','chat','campeonato','showdown'].includes(m.t)) log('[depurar]', JSON.stringify(m).slice(0, 400));
  switch (m.t) {
    case 'welcome':
      S.welcome = true;
      clearTimeout(S.alarmeQueda); S.alarmeQueda = null;
      if (!S.jaConectou) { S.jaConectou = true; aviso('voltou', 'Bot ligado e caçando'); }
      else if (S.avisouQueda) { aviso('voltou', 'Bot reconectado', '', true); }
      S.avisouQueda = false;
      S.stats.offMs = (S.stats.offMs ?? 0) + (Date.now() - (S.offDesde ?? S.stats.inicio)); S.offDesde = null;
      S.conectadoEm = Date.now();
      if (!S.restaurado) { S.restaurado = true; S.mortes = (ACUM.mortesRecentes ?? []).filter((t) => Date.now() - t < 10 * 60_000); S.desistiDegrau = { ...(ACUM.desistiDegrau ?? {}) }; S.mataPk = { ...(ACUM.mataPk ?? {}) }; }
      S.tentativas = 0;
      S.hunts = m.hunts ?? [];
      S.bolas = m.catalogoBolas ?? [];
      if (m.maxEquipe) S.maxEquipe = m.maxEquipe;
      if (m.tabelaTipos) S.tabelaTipos = m.tabelaTipos;
      if (Array.isArray(m.bossesCatalogo)) S.bossesCatalogo = m.bossesCatalogo;
      try { mkdirSync(join(AQUI, 'mercado'), { recursive: true }); writeFileSync(join(AQUI, 'mercado', 'welcome-catalogos.json'), JSON.stringify({ em: new Date().toISOString(), lojaProdutos: m.lojaProdutos, tiposBoost: m.tiposBoost, economia: m.economia, catalogoBolas: m.catalogoBolas, itensCompraveis: m.itensCompraveis, chanceShiny: m.chanceShiny, captura: m.captura, mercado: m.mercado, casas: m.casas, bicicletas: m.bicicletas, shinyStone: m.shinyStone, oferenda: m.oferenda, mega: m.mega, bossesCatalogo: m.bossesCatalogo })); } catch {}
      mesclarEstado({ ...(m.estado ?? {}), cheio: true });
      log(`welcome: ${S.hunts.length} hunts, Nv ${S.eu?.level}, ouro ${S.eu?.gold}`);
      if (!S.areasLogadas) {
        S.areasLogadas = true;
        const por = {}; for (const h of S.hunts) { const a = (por[h.area] ??= { n: 0, min: Infinity, max: 0 }); a.n++; a.min = Math.min(a.min, h.nivel ?? 0); a.max = Math.max(a.max, h.nivel ?? 0); }
        log('áreas das hunts: ' + Object.entries(por).map(([a, x]) => `${a} ${x.n} (nível ${x.min}–${x.max})`).join(', ') + ` · ativas agora: ${regioesAtivas().join(',') || '-'}`);
        log(`campos da hunt: ${Object.keys(S.hunts[0] ?? {}).join(',')} · campos do pokemon: ${[...new Set([...S.pokemons.values()].flatMap((p) => Object.keys(p)))].join(',')}`);
        try { writeFileSync(join(AQUI, 'mercado', 'welcome-hunts.json'), JSON.stringify(S.hunts.map(({ especies, ...h }) => ({ ...h, especies: (especies ?? []).length })))); } catch {}
      }
      break;
    case 'estado': {
      const antes = S.eu?.gold;
      mesclarEstado(m.estado);
      const depois = S.eu?.gold;
      // salto de ouro que nenhum abate explica. A venda da captura (Auto Venda) chega no mesmo segundo,
      // antes ou depois do salto: espera até 5 s por ela; o que sobrar sem venda é prêmio e fica fora do ouro/h.
      if (antes != null && depois != null && depois - antes >= CFG.ouroSaltoMin) S.saltos.push({ valor: depois - antes, em: Date.now() });
      conciliarSaltos();
      break;
    }
    case 'passe': log('passe de batalha:', JSON.stringify(m).slice(0, 300)); break;
    case 'campeonato': aoCampeonato(m); break;
    case 'raid': aoRaid(m); break;
    case 'showdown': aoShowdown(m); break;
    case 'comunidade': guardarTorneio('comunidade', m); break;
    case 'topCatch': aoTopCatch(m); break;
    case 'pvp': guardarTorneio('pvp', m); aoPvp(m); break;
    case 'campo.init': case 'campo': aplicarCampo(m); break;
    case 'batalha': for (const ev of m.ev ?? []) aoEvento(ev); break;
    case 'sessao.renovada': if (m.token) { CFG.token = m.token; salvarToken(m.token); } break;
    case 'erro':
      log('erro do servidor:', m.chave ?? m.msg ?? JSON.stringify(m).slice(0, 200));
      if (/devagar|muitas mensagens/i.test(String(m.msg ?? m.chave ?? ''))) { S.devagarAte = Date.now() + 10_000; log('servidor pediu calma: pausando envios por 10 s'); }
      break;
  }
}

// ---------- conexão ----------
function conectar() {
  if (S.parar) return;
  const url = `wss://${CFG.host}`;
  let ws;
  try {
    ws = new WebSocket(url, { headers: { Origin: `https://${CFG.host}`, 'User-Agent': 'Mozilla/5.0 (PokeIdle farm bot)' } });
  } catch {
    ws = new WebSocket(url);
  }
  S.ws = ws;
  S.welcome = false;
  let ultimaMsg = Date.now();
  let ping, watchdog, loop, rel, capt;

  ws.onopen = () => {
    log('conectado; enviando hello');
    ws.send(JSON.stringify({ t: 'hello', nick: CFG.nick, token: CFG.token, delta: 1, dispositivo: CFG.dispositivo }));
    ping = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 25_000);
    watchdog = setInterval(() => { if (Date.now() - ultimaMsg > 60_000) { log('sem mensagens há 60 s, reconectando'); ws.close(); } }, 10_000);
    loop = setInterval(tique, 3_000);
    capt = setInterval(() => { if (S.welcome && S.eu) { cuidarDaCaptura(); tentarTrocaPendente(); } }, 250);
    rel = setInterval(resumo, 60_000);
  };
  ws.onmessage = (ev) => {
    ultimaMsg = Date.now();
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    try { aoMensagem(m); } catch (e) { logErro(`mensagem ${m?.t ?? '?'}`, e); }
  };
  ws.onerror = (e) => log('erro de socket:', e?.message ?? '');
  ws.onclose = async (ev) => {
    clearInterval(ping); clearInterval(watchdog); clearInterval(loop); clearInterval(rel); clearInterval(capt);
    S.offDesde ??= Date.now();
    log(`desconectado (código ${ev.code}${ev.reason ? `, ${ev.reason}` : ''})`);
    if (ev.code === 4001) {
      log(`sessão tomada por outra conexão (o jogo foi aberto em outro lugar). Pausando por ${CFG.pausaHoras} h — apague o arquivo PAUSADO para voltar antes.`);
      try { writeFileSync(ARQ_PAUSA, new Date().toISOString()); } catch {}
      S.parar = true;
      await Promise.race([aviso('caiu', 'Bot pausado: o jogo foi aberto em outro lugar', `Volta sozinho em ${CFG.pausaHoras} h, ou apague o arquivo PAUSADO.`, true), new Promise((r) => setTimeout(r, 5000))]);
      process.exit(0);
    }
    if (ev.code === 4003) { log('servidor recusou a conexão (bloqueio). Parando.'); S.parar = true;
      await Promise.race([aviso('caiu', 'Bot parado: o servidor recusou a conexão', '', true), new Promise((r) => setTimeout(r, 5000))]); process.exit(1); }
    S.alarmeQueda ??= setTimeout(() => { S.avisouQueda = true; aviso('caiu', 'Bot desconectado há 5 minutos', 'Continua tentando reconectar.', true); }, 5 * 60_000);
    S.tentativas++;
    const espera = Math.min(30_000, 1000 * 2 ** Math.min(S.tentativas, 5)) + Math.random() * 1000;
    log(`reconectando em ${Math.round(espera / 1000)} s`);
    setTimeout(conectar, espera);
  };
}

// ---------- catálogos públicos (espécies e itens), baixados na partida ----------
const ESPECIES = new Map(); // pokeId → { nome, type1, type2, evolvesToId, evolveLevel }
const ITEM_POR_NOME = new Map();
const LOOK_POR_NOME = new Map(); // nome da espécie → looktype (sprite)
// sprite de um looktype: lê o índice e o manifesto públicos do jogo e devolve só os retângulos de cada direção
const SPRITES = new Map(); let INDICE_OUTFITS = null;
async function spriteDe(lt) {
  if (SPRITES.has(lt)) return SPRITES.get(lt);
  const p = (async () => {
    const base = `https://${CFG.host}`;
    const pegar = async (u) => { const r = await fetch(base + u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
    INDICE_OUTFITS ??= pegar('/assets/asset-packs/outfits-index.json').then((j) => j.outfits);
    const ent = (await INDICE_OUTFITS)[String(lt)]; if (!ent) return null;
    const loc = (u) => base + u.replace(/^\/assets-packs/, '/assets/asset-packs');
    const man = await pegar(loc(ent.manifest).slice(base.length));
    const cat = Object.values(man.categories)[0];
    const dirs = {}; let w = 32, h = 32;
    for (const [k, a] of Object.entries(man.assets)) {
      const stem = k.split('/').pop().replace(/\.png$/, ''); if (stem.endsWith('_template')) continue;
      const n = stem.split('_').map(Number); const f = a.frames?.[0]; if (!f) continue;
      w = a.width; h = a.height; (dirs[n[3]] ??= [])[n[0] - 1] = { p: f.page ?? 0, x: f.x, y: f.y, w: f.w, h: f.h };
    }
    for (const d of Object.keys(dirs)) dirs[d] = dirs[d].filter(Boolean);
    return { nome: ent.name, w, h, paginas: cat.pages.map((pg) => loc(pg.image)), dirs };
  })().catch(() => null);
  SPRITES.set(lt, p); p.then((s) => { if (!s) SPRITES.delete(lt); });
  return p;
}
// ícones oficiais (só para o painel): o jogo serve os arquivos em /assets/site, e ícone sem caminho fica em items/
const ICONES_ITEM = {};
function iconeOficial(icon) {
  if (!icon) return null;
  const base = `https://${CFG.host}`;
  if (icon.startsWith('/img/') || icon.startsWith('/midia/')) return base + icon;
  return base + (icon.startsWith('/assets/') ? '/assets/site' + icon : '/assets/site/assets/items/' + icon);
}
async function carregarCatalogos() {
  const base = `https://${CFG.host}/assets/`;
  const pegar = async (f) => (await fetch(base + f, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  try {
    for (const f of ['creatures.json', 'creatures-novos.json']) {
      const d = await pegar(f);
      for (const c of d.creatures ?? []) { ESPECIES.set(c.pokeId, { nome: c.name, type1: c.type1, type2: c.type2 ?? null, evolvesToId: c.evolvesToId ?? null, evolveLevel: c.evolveLevel ?? null, looktype: c.looktype ?? null, bst: ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'].reduce((t, k) => t + (Number(c[k]) || 0), 0), rarity: c.rarity ?? null }); if (c.looktype != null && !LOOK_POR_NOME.has(c.name)) LOOK_POR_NOME.set(c.name, c.looktype); }
    }
    const it = await pegar('items.json');
    for (const i of it.items ?? []) { ITEM_POR_NOME.set(i.name, i.id); ICONES_ITEM[i.id] = iconeOficial(i.icon); }
    log(`catálogos: ${ESPECIES.size} espécies, ${ITEM_POR_NOME.size} itens`);
  } catch (e) { log('não consegui baixar os catálogos (equipe por tipo e evolução ficam limitadas):', e.message); }
}
carregarCatalogos();

// ---------- tipos (copiado de shared/tipo-efetividade.mjs) ----------
const DIAGONAL_DE_TIPOS = { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, GRASS: 0.5, ICE: 0.5, POISON: 0.5, PSYCHIC: 0.5, DARK: 0.5, STEEL: 0.5, GHOST: 2, DRAGON: 2 };
function efetividade(atq, def1, def2) {
  const tab = S.tabelaTipos ?? {};
  const um = (a, d) => { a = String(a).toUpperCase(); d = String(d).toUpperCase(); return a === d ? (DIAGONAL_DE_TIPOS[a] ?? 1) : (tab[a]?.[d] ?? 1); };
  let v = um(atq, def1);
  if (def2 && def2 !== def1) v *= um(atq, def2);
  return v;
}
// nota de uma hunt para o nosso ativo: (dano que causamos) / (dano que levamos), pesada pelos pontos de spawn
// valor esperado de um shiny desta hunt, em Gemas: mediana de 14 dias do Radar de cada espécie,
// pesada pelos pontos de spawn e pela chance de captura do estágio (2º e 3º estágio pegam menos)
const FATOR_ESTAGIO = [2.8669, 3.5745, 4.4681];
let PRE_EVO = null; const VALOR_ESP = new Map();
function estagioDe(pokeId) {
  if (!PRE_EVO) { PRE_EVO = new Map(); for (const [id, e] of ESPECIES) if (e.evolvesToId) PRE_EVO.set(e.evolvesToId, id); }
  let n = 0, id = pokeId; while (PRE_EVO.has(id) && n < 2) { id = PRE_EVO.get(id); n++; }
  return n;
}
function valorShinyEspecie(pokeId) {
  const c = VALOR_ESP.get(pokeId); if (c && Date.now() - c.em < 600_000) return c.v;
  const esp = ESPECIES.get(pokeId);
  const serie = (RADAR.hist?.[esp?.nome]?.shiny ?? []).slice(-14);
  const v = serie.length ? mediana(serie.flatMap((d) => Array(Math.max(1, d.vendas ?? 1)).fill(d.mediana))) : CFG.huntValorSemDado;
  VALOR_ESP.set(pokeId, { v, em: Date.now() });
  return v;
}
function valorDaHunt(h) {
  let soma = 0, peso = 0;
  for (const e of h.especies ?? []) {
    const p = e.pontos ?? 1;
    soma += p * valorShinyEspecie(e.pokeId) * (FATOR_ESTAGIO[0] / FATOR_ESTAGIO[estagioDe(e.pokeId)]); peso += p;
  }
  return peso ? soma / peso : 0;
}
function notaDaHunt(h, pk) {
  const meus = (pk?.tipos ?? []).filter(Boolean);
  if (!meus.length || !S.tabelaTipos) return 1;
  let soma = 0, peso = 0;
  for (const e of h.especies ?? []) {
    const esp = ESPECIES.get(e.pokeId);
    if (!esp?.type1) continue;
    const ataque = Math.max(...meus.map((t) => efetividade(t, esp.type1, esp.type2)));
    const levo = Math.max(...[esp.type1, esp.type2].filter(Boolean).map((t) => efetividade(t, meus[0], meus[1])));
    const p = e.pontos ?? 1;
    soma += p * (ataque / Math.max(0.25, levo)); peso += p;
  }
  return peso ? soma / peso : 1;
}

// ---------- equipe: os 5 de maior poder que podem lutar; o mais forte como ativo ----------
// Só o ativo luta (o cliente usa activeId para golpes); os outros são reserva.
// Shiny fica fora da equipe (é para vender); o jogo nunca o vende sozinho.
// venda pedida pelo dono no painel: tira as reservas da equipe e vende ao NPC (nunca ativo, inicial, shiny ou lendário)
function venderReservas() {
  const alvo = equipe().filter((p) => p.id !== S.eu?.activeId && !p.starter && !p.shiny && !p.legendary && !p.mega);
  if (!alvo.length) { log('vender reservas: nenhuma reserva vendável'); return []; }
  return venderNoDepot(alvo, 'vender reservas');
}
function venderNoDepot(alvo, motivo) {
  S.vendendo = new Set(alvo.map((p) => p.id)); S.depurarAte = Date.now() + 120000;
  // o Depot só abre no Centro Pokemon (Cerulean), e só se entra lá ~2,3 s sem combate (entre as ondas): tenta a cada 1 s
  S.noDepotAte = Date.now() + 120000;
  const inicio = Date.now(); S.noDepotAte = inicio + 120000 + alvo.length * 400; let fase = 'ir';
  const passo = () => {
    if (Date.now() - inicio > 110000) { log(`${motivo}: desisti (não consegui entrar no Centro em 110 s)`); S.vendendo = null; S.noDepotAte = 0; return; }
    if (fase === 'ir') {
      if (!S.eu?.noCentro) { enviar({ t: 'centro.ir' }); return setTimeout(passo, 1000); }
      log(`${motivo}: no Centro, ${alvo.length} para vender`); fase = 'tirar';
      const daEquipe = alvo.filter((p) => S.pokemons.get(p.id)?.slot != null);
      for (const p of daEquipe) enviar({ t: 'team.move', pokemonId: p.id, slot: null });
      return setTimeout(passo, daEquipe.length ? 4000 : 500);
    }
    if (fase === 'tirar') {
      log(`${motivo}: vendendo ao NPC`); fase = 'vender';
      for (const p of alvo) enviar({ t: 'shop.sellPokemon', pokemonId: p.id });
      return setTimeout(passo, 5000 + alvo.length * 400);
    }
    const ficaram = alvo.filter((p) => S.pokemons.has(p.id));
    log(ficaram.length ? `${motivo}: não vendidos: ${ficaram.map((p) => p.nome).join(', ')}` : `${motivo}: vendidos ${alvo.map((p) => p.nome).join(', ')}`);
    S.vendendo = null; S.noDepotAte = 0;
    if (S.eu?.huntSlug) { log(`${motivo}: voltando para a hunt`); enviar({ t: 'hunt.select', slug: S.eu.huntSlug }); }
  };
  log(`${motivo}: indo ao Centro (Depot)`); passo();
  return alvo.map((p) => `${p.nome} Nv${p.level}`);
}
function podeUsar(p) { const lv = S.eu?.level ?? 0; return p.starter || (p.level ?? 0) <= lv + 5; }
// com o time forte a nota da Coleção nunca passa do mínimo do Mercado (3,5), senão vendável a jogador iria ao NPC
function notaDaColecao() { return CFG.timeForte ? Math.min(CFG.colecaoNota ? CFG.colecaoNotaMin : 3.5, 3.5) : CFG.colecaoNotaMin; }
function colecaoProtege() { const c = S.eu?.automation?.autoColecao; return !!(c?.shiny?.on && c?.lendario?.on && c?.potencial?.on && c?.nota?.on && Number(c.nota.min) <= 3.5); }
// comprado pelo sniper: nunca vai ao NPC (custou Gemas)
function doSniper(p) { return (ACUM.snCompras ?? []).some((r) => r.pokemonId === p.id || (r.nome === p.nome && r.nivel === p.level && !!r.shiny === !!p.shiny)); }
// capturado por esta conta: pokemon comprado ou recebido de outro jogador não é vendido
function capturadoPorMim(p) { return p.caughtBy === true || (typeof p.caughtBy === 'string' && p.caughtBy.toLowerCase() === String(CFG.nick).toLowerCase()); }
// TIME_FORTE: o ativo e, nas outras vagas, o pokemon de maior poder de cada espécie (nunca duas da mesma)
function timeDesejado() {
  const max = S.maxEquipe ?? 5;
  const ordenados = [...S.pokemons.values()].filter((p) => !S.vendendo?.has(p.id) && podeUsar(p) && !p.shiny && !(CFG.sniperPkRevender && doSniper(p))).sort((a, b) => (b.poder ?? 0) - (a.poder ?? 0) || (a.slot == null) - (b.slot == null));
  const ativo = S.pokemons.get(S.eu?.activeId), time = ativo ? [ativo] : [], especies = new Set(time.map((p) => p.speciesId));
  for (const p of ordenados) { if (time.length >= max) break; if (!especies.has(p.speciesId)) { time.push(p); especies.add(p.speciesId); } }
  return time.sort((a, b) => (b.poder ?? 0) - (a.poder ?? 0));
}
// o que pode ir ao NPC: só o que está parado no Depot, fora do time desejado, e que a própria Auto Venda do jogo venderia
function vendaveisTimeForte() {
  if (!S.eu || !ESPECIES.size) return []; // sem catálogo não dá para saber a raridade: não vende nada
  const fica = new Set(timeDesejado().map((p) => p.id)), colecao = new Set(S.eu.automation?.pokemonTravado ?? []);
  return [...S.pokemons.values()].filter((p) => p.slot == null && p.id !== S.eu.activeId && !fica.has(p.id) && !colecao.has(p.id)
    && !p.starter && !p.shiny && !p.legendary && !p.mega && !p.heldItemId && !p.skin && !p.casa
    && capturadoPorMim(p) && !doSniper(p)
    && !(p.potencia >= 4) && !((p.level ?? 0) > 100) && !(Number(p.refinoTotal) > 0) && !p.tmElemental && !p.tmAoe
    && p.nota != null && Number(p.nota) < CFG.vendaNotaMax // sem nota conhecida, não vende
    && !RARIDADE_PROTEGIDA.has(ESPECIES.get(p.speciesId)?.rarity ?? 'SEM_CATALOGO'));
}
// vende na hora, sem sair da hunt (a mesma mensagem do botão "Vender" do Market). Se o servidor não aceitar fora do
// Centro, passa a vender em lotes no Depot.
function cuidarDaVenda() {
  if (!CFG.timeForte || !S.eu || CFG.somenteLer || S.vendendo || Date.now() - (S.conectadoEm ?? 0) < 15_000) return;
  if (S.eu.automation?.autoVendaDepot === true || S.eu.boss?.arena || S.eu.boss?.auto) return;
  if (!colecaoProtege()) { if (!S.avisouColecao && Date.now() - S.conectadoEm > 120_000) { S.avisouColecao = true; log('venda dos fracos: esperando a Auto Coleção confirmar a proteção; nada é vendido até lá'); } return; }
  const v = S.vendaDireta;
  if (v) {
    const ficaram = v.alvo.filter((p) => S.pokemons.has(p.id));
    if (ficaram.length && Date.now() - v.em < 15_000) return; // esperando o servidor
    const vendidos = v.alvo.filter((p) => !S.pokemons.has(p.id));
    if (vendidos.length) log(`venda dos fracos: vendidos sem sair da hunt: ${vendidos.map((p) => `${p.nome} Nv${p.level}`).join(', ')}`);
    if (!vendidos.length) { S.vendaSoNoCentro = true; log('venda dos fracos: o servidor não vendeu fora do Centro; passo a vender em lotes no Depot'); }
    S.vendaDireta = null; return;
  }
  for (const p of S.pokemons.values()) if (p.slot == null && !capturadoPorMim(p) && !(S.avisadoDono ??= new Set()).has(p.id)) { S.avisadoDono.add(p.id); log(`venda dos fracos: não vendo ${p.nome} Nv${p.level}: não consta como capturado por você (${JSON.stringify(p.caughtBy ?? null)})`); }
  const alvo = vendaveisTimeForte().slice(0, 20);
  if (!alvo.length) return;
  if (!S.vendaSoNoCentro) {
    S.vendaDireta = { alvo, em: Date.now() }; S.depurarAte = Date.now() + 15_000;
    for (const p of alvo) enviar({ t: 'shop.sellPokemon', pokemonId: p.id });
    return;
  }
  const desde = Date.now() - (S.ultimaVendaForte ?? S.stats.inicio);
  if (alvo.length < CFG.vendaLote && desde < CFG.vendaMaxMin * 60_000) return;
  S.ultimaVendaForte = Date.now();
  venderNoDepot(vendaveisTimeForte().slice(0, 60), 'venda dos fracos');
}
function cuidarDaEquipe() {
  if (!CFG.gerirEquipe || !S.eu || S.equipePendente || Date.now() - (S.ultimaEquipe ?? 0) < 12_000) return;
  const max = CFG.timeForte ? S.maxEquipe ?? 5 : Math.min(S.maxEquipe ?? 5, Math.max(1, CFG.equipeMax));
  const todos = [...S.pokemons.values()].filter((p) => !S.vendendo?.has(p.id));
  const ordenados = todos.filter((p) => podeUsar(p) && !p.shiny).sort((a, b) => (b.poder ?? 0) - (a.poder ?? 0));
  const poderTopo = ordenados[0]?.poder ?? 0;
  // reserva fraca só entra para morrer (e cada desmaio custa XP): fica de fora
  const candidatos = ordenados.filter((p, i) => i === 0 || (p.poder ?? 0) >= poderTopo * CFG.reservaPoderMin);
  const desejados = CFG.timeForte ? timeDesejado() : candidatos.slice(0, max);
  const idsDesejados = new Set(desejados.map((p) => p.id));
  const naEquipe = todos.filter((p) => p.slot != null);
  const ativo = S.pokemons.get(S.eu.activeId);
  // 1) ativo = o mais forte vivo da equipe desejada
  const melhorVivo = desejados.find((p) => p.slot != null && (p.hp ?? 1) > 0);
  if (melhorVivo && ativo && melhorVivo.id !== ativo.id && (ativo.hp ?? 1) > 0 && (melhorVivo.poder ?? 0) > (ativo.poder ?? 0)) {
    S.ultimaEquipe = Date.now();
    log(`ativo → ${melhorVivo.nome} Nv${melhorVivo.level} (poder ${melhorVivo.poder}, antes ${ativo.nome} ${ativo.poder})`);
    return enviar({ t: 'team.active', pokemonId: melhorVivo.id });
  }
  // 1b) tira da equipe quem não é desejado (fraco demais), nunca o ativo nem o último
  const fraco = naEquipe.filter((p) => !idsDesejados.has(p.id) && p.id !== S.eu.activeId).sort((a, b) => (a.poder ?? 0) - (b.poder ?? 0))[0];
  if (CFG.reservaPoderMin > 0 && fraco && naEquipe.length > 1) {
    S.ultimaEquipe = Date.now();
    log(`equipe → tira ${fraco.nome} Nv${fraco.level} (poder ${fraco.poder}): fraco demais para a hunt, só morreria`);
    return pendurarEquipe({ t: 'team.move', pokemonId: fraco.id, slot: null });
  }
  // 2) põe na equipe quem deveria estar, se houver vaga
  const ocupados = new Set(naEquipe.map((p) => p.slot));
  const livre = [...Array(max).keys()].find((s) => !ocupados.has(s));
  const falta = desejados.find((p) => p.slot == null);
  if (falta && livre != null) {
    S.ultimaEquipe = Date.now();
    log(`equipe ← ${falta.nome} Nv${falta.level} (poder ${falta.poder}) no slot ${livre}`);
    return pendurarEquipe({ t: 'team.move', pokemonId: falta.id, slot: livre });
  }
  // 3) equipe cheia: tira o mais fraco que não deveria estar (nunca o ativo)
  if (falta && livre == null) {
    const sobra = naEquipe.filter((p) => !idsDesejados.has(p.id) && p.id !== S.eu.activeId).sort((a, b) => (a.poder ?? 0) - (b.poder ?? 0))[0];
    if (sobra) {
      S.ultimaEquipe = Date.now();
      log(`equipe → tira ${sobra.nome} Nv${sobra.level} (poder ${sobra.poder}) para abrir vaga`);
      return pendurarEquipe({ t: 'team.move', pokemonId: sobra.id, slot: null });
    }
  }
}

// ---------- evolução: nível + pedra do tipo; pedra comprada em ouro no Mercado, com teto ----------
// copiado de shared/evolucoes-ramificadas.mjs (TIPO_DA_PEDRA_POR_ESPECIE e chaves de EVOLUCOES_RAMIFICADAS)
const TIPO_PEDRA_FORCADO = { 16: 'FLYING', 17: 'FLYING', 21: 'FLYING', 163: 'FLYING', 276: 'FLYING', 13276: 'FLYING', 333: 'FLYING', 13333: 'FLYING', 396: 'FLYING', 397: 'FLYING', 627: 'FLYING', 661: 'FLYING', 731: 'FLYING', 732: 'FLYING' };
const RAMIFICADAS = new Set([44, 61, 79, 133, 236, 265, 13265, 281, 13281, 290, 13290, 361, 13361, 366, 13366, 412, 25, 102, 104, 109, 439, 156, 502, 548, 627, 704, 712, 723, 744, 550, 5079, 123, 790, 840, 646, 935, 898, 1017, 217, 680, 800]);
const PEDRA_POR_TIPO = { NORMAL: 'Sun Stone', FIRE: 'Fire Stone', WATER: 'Water Stone', GRASS: 'Leaf Stone', ELECTRIC: 'Thunder Stone', ICE: 'Ice Stone', FIGHTING: 'Punch Stone', POISON: 'Venom Stone', GROUND: 'Earth Stone', FLYING: 'Feather Stone', PSYCHIC: 'Enigma Stone', BUG: 'Cocoon Stone', ROCK: 'Rock Stone', GHOST: 'Darkness Stone', DRAGON: 'Ancient Stone', DARK: 'Darkness Stone', STEEL: 'Metal Stone', FAIRY: 'Heart Stone' };
// destinos das evoluções ramificadas (dados extraídos de shared/evolucoes-ramificadas.mjs do cliente; nível = do pokemon)
const EVO_RAMIFICADAS = {"25":[{"para":26,"nivel":80},{"para":4026,"nivel":43100}],"44":[{"para":45,"nivel":70},{"para":182,"nivel":50}],"61":[{"para":62,"nivel":80},{"para":186,"nivel":70}],"79":[{"para":80,"nivel":60},{"para":199,"nivel":1000}],"102":[{"para":103,"nivel":100},{"para":4103,"nivel":34650}],"104":[{"para":105,"nivel":50},{"para":4105,"nivel":34650}],"109":[{"para":110,"nivel":60},{"para":5110,"nivel":69300}],"123":[{"para":212,"nivel":80},{"para":900,"nivel":27500}],"133":[{"para":134,"nivel":80,"fixo":true},{"para":135,"nivel":80,"fixo":true},{"para":136,"nivel":80,"fixo":true},{"para":196,"nivel":80,"fixo":true},{"para":197,"nivel":80,"fixo":true},{"para":470,"nivel":80,"fixo":true},{"para":471,"nivel":80,"fixo":true},{"para":700,"nivel":80,"fixo":true}],"156":[{"para":157,"nivel":80},{"para":6157,"nivel":86150}],"217":[{"para":901,"nivel":46150},{"para":8901,"nivel":160300}],"236":[{"para":237,"nivel":60},{"para":106,"nivel":60},{"para":107,"nivel":60}],"265":[{"para":266,"nivel":650},{"para":268,"nivel":500}],"281":[{"para":282,"nivel":100},{"para":475,"nivel":1500}],"290":[{"para":291,"nivel":700},{"para":292,"nivel":500}],"361":[{"para":362,"nivel":80},{"para":478,"nivel":1250}],"366":[{"para":367,"nivel":700},{"para":368,"nivel":550}],"412":[{"para":413,"nivel":2000},{"para":414,"nivel":1250},{"para":8413,"nivel":2000},{"para":9413,"nivel":2000}],"439":[{"para":122,"nivel":80},{"para":5122,"nivel":64000}],"502":[{"para":503,"nivel":100},{"para":6503,"nivel":86150}],"548":[{"para":549,"nivel":100},{"para":6549,"nivel":69300}],"550":[{"para":902,"nivel":69300},{"para":8902,"nivel":69300}],"627":[{"para":628,"nivel":100},{"para":6628,"nivel":69300}],"646":[{"para":8646,"nivel":8600},{"para":9646,"nivel":8600}],"680":[{"para":681,"nivel":16000},{"para":8681,"nivel":21200}],"704":[{"para":705,"nivel":40},{"para":6705,"nivel":64000}],"712":[{"para":713,"nivel":100},{"para":6713,"nivel":69300}],"723":[{"para":724,"nivel":100},{"para":6724,"nivel":86150}],"744":[{"para":745,"nivel":34650},{"para":8745,"nivel":34650},{"para":9745,"nivel":34650}],"790":[{"para":791,"nivel":7500},{"para":792,"nivel":7500}],"800":[{"para":8800,"nivel":35150},{"para":9800,"nivel":35150}],"840":[{"para":841,"nivel":30450},{"para":842,"nivel":26150},{"para":1011,"nivel":40000}],"898":[{"para":8898,"nivel":64950},{"para":9898,"nivel":64950}],"935":[{"para":936,"nivel":120550},{"para":937,"nivel":120550}],"1017":[{"para":9017,"nivel":160300},{"para":8017,"nivel":160300},{"para":12017,"nivel":160300}],"5079":[{"para":5080,"nivel":69300},{"para":5199,"nivel":69300}],"13265":[{"para":266,"nivel":650},{"para":268,"nivel":500}],"13281":[{"para":282,"nivel":100},{"para":475,"nivel":1500}],"13290":[{"para":291,"nivel":700},{"para":292,"nivel":500}],"13361":[{"para":362,"nivel":80},{"para":478,"nivel":1250}],"13366":[{"para":367,"nivel":700},{"para":368,"nivel":550}]};
const tentativasEvo = new Set();
let cotacaoPedra = null; // { seq, itemId, nome }
function cuidarDaEvolucao() {
  if (!CFG.evoluir || !S.eu || !ESPECIES.size || Date.now() - (S.ultimaEvo ?? 0) < 30_000) return;
  if (cotacaoPedra && Date.now() - cotacaoPedra.em > 30_000) cotacaoPedra = null; // cotação sem resposta
  const equipeAtual = [...S.pokemons.values()].filter((p) => p.slot != null && !p.shiny && (!CFG.timeForte || p.id === S.eu.activeId)).sort((a, b) => (b.poder ?? 0) - (a.poder ?? 0));
  for (const p of equipeAtual) {
    const esp = ESPECIES.get(p.speciesId);
    // nível do catálogo (o cliente só rebaixa esse nível para espécies 252+, então para Kanto vale o do catálogo)
    if (!esp?.evolvesToId) continue;
    // ramificada: entre os destinos que o nível já libera, o da pedra que já temos; senão, o de maior soma de stats base
    let alvoId = esp.evolvesToId, tipo = TIPO_PEDRA_FORCADO[p.speciesId] ?? esp.type1;
    const ram = EVO_RAMIFICADAS[p.speciesId];
    if (ram) {
      const ops = ram.filter((o) => (p.level ?? 0) >= Math.max(CFG.evoNivelMin, o.nivel) && ESPECIES.get(o.para)).map((o) => {
        const d = ESPECIES.get(o.para); const tp = TIPO_PEDRA_FORCADO[p.speciesId] ?? d.type1 ?? esp.type1;
        const id = ITEM_POR_NOME.get(PEDRA_POR_TIPO[String(tp).toUpperCase()]);
        return { para: o.para, tipo: tp, pedraId: id, tem: (S.eu.items?.[id] ?? 0) > 0, bst: d.bst ?? 0 };
      }).filter((o) => o.pedraId);
      if (!ops.length) continue;
      ops.sort((x, y) => (y.tem - x.tem) || (y.bst - x.bst));
      alvoId = ops[0].para; tipo = ops[0].tipo;
    } else if ((p.level ?? 0) < Math.max(CFG.evoNivelMin, esp.evolveLevel ?? 0)) continue;
    const nomePedra = PEDRA_POR_TIPO[String(tipo).toUpperCase()];
    const pedraId = ITEM_POR_NOME.get(nomePedra);
    if (!pedraId) continue;
    const chave = `${p.id}:${Math.floor((p.level ?? 0) / 5)}`;
    if (tentativasEvo.has(chave)) continue;
    S.ultimaEvo = Date.now();
    if ((S.eu.items?.[pedraId] ?? 0) > 0) {
      tentativasEvo.add(chave);
      log(`evoluir ${p.nome} Nv${p.level} → ${ESPECIES.get(alvoId)?.nome ?? alvoId} com ${nomePedra}${ram ? ' (evolução ramificada)' : ''}`);
      return enviar({ t: 'pokemon.evoluir', pokemonId: p.id, alvoId });
    }
    if (!cotacaoPedra) {
      cotacaoPedra = { seq: Date.now() % 1e9, itemId: pedraId, nome: nomePedra, em: Date.now() };
      log(`cotando ${nomePedra} no Mercado (ouro) para evoluir ${p.nome}`);
      return enviar({ t: 'market.cotarLote', tipo: 'item', itemId: pedraId, moeda: 'gold', qtd: 1, seq: cotacaoPedra.seq });
    }
    return;
  }
}
function aoCotacao(m) {
  if (!cotacaoPedra || m.seq !== cotacaoPedra.seq) return;
  const c = cotacaoPedra; cotacaoPedra = null;
  const ouro = S.eu?.gold ?? 0;
  const total = Number(m.total) || 0;
  if (!m.disponivel || !total) return log(`${c.nome}: sem anúncio em ouro agora`);
  if (total > CFG.pedraPrecoMax || total > ouro * CFG.pedraFracaoMax) return log(`${c.nome}: ${total.toLocaleString('pt-BR')} de ouro passa do teto (máx ${CFG.pedraPrecoMax.toLocaleString('pt-BR')} e ${Math.round(CFG.pedraFracaoMax * 100)}% do ouro)`);
  log(`comprando 1× ${c.nome} por ${total.toLocaleString('pt-BR')} de ouro no Mercado`);
  enviar({ t: 'market.comprarLote', tipo: 'item', itemId: c.itemId, moeda: 'gold', qtd: 1, precoMax: m.precoMax, totalMax: total });
}

// ---------- rotina grátis: torneios e chocadeira ----------
const OVOS = [70093, 70092, 70091]; // Mystery Egg P4, P3, P2 (melhor primeiro)
const tentadosCamp = new Set();
function cuidarDaRotina() {
  const agora = Date.now();
  if (CFG.torneios && agora - S.conectadoEm > 60_000 && agora - (S.ultimoTorneio ?? 0) > 6 * 3600_000) {
    S.ultimoTorneio = agora;
    enviar({ t: 'campeonato.info', id: null });
    enviar({ t: 'showdown.info' });
    enviar({ t: 'comunidade.info' });
  }
  if (CFG.chocadeira && agora - (S.ultimaChoc ?? 0) > 60_000) {
    const ch = S.eu?.chocadeira; const items = S.eu?.items ?? {};
    const ovo = OVOS.find((id) => (items[id] ?? 0) > 0);
    if (ch && ovo && (ch.ovos?.length ?? 0) < (ch.total ?? 1)) {
      const usados = new Set((ch.ovos ?? []).map((o, i) => o?.slot ?? i));
      const slot = [...Array(ch.total ?? 1).keys()].find((i) => !usados.has(i));
      if (slot != null) { S.ultimaChoc = agora; log(`chocadeira: colocando ovo ${ovo} no slot ${slot}`); enviar({ t: 'chocadeira.colocar', slot, ovo }); }
    }
  }
}
function aoPvp(m) {
  if (m.filaRecusa) log('pvp: fila recusada —', m.filaRecusa.msg ?? JSON.stringify(m.filaRecusa));
  if (m.filaAutoDesligada) log('pvp: fila automática desligada pelo servidor');
  if (m.filaAuto) log('pvp: entrou na fila automática');
  if (m.rank && S.pvpRankLog !== `${m.rank.pontos}:${m.rank.partidas}`) { S.pvpRankLog = `${m.rank.pontos}:${m.rank.partidas}`; log(`pvp: ${m.rank.tierId} ${m.rank.divisaoNum} · ${m.rank.pontos} PR · ${m.rank.vitorias}V/${m.rank.derrotas}D · posição ${m.posicao ?? '-'} de ${m.totalClassificados ?? '?'} (prêmio mensal até a 2.000ª)`); }
  if (!CFG.pvp || CFG.somenteLer || (S.eu?.level ?? 0) < 150) return;
  // sem time salvo: monta com os 5 de maior nível (só uma vez por execução; time escolhido por você é mantido)
  const melhorPvp = [...S.pokemons.values()].sort(porPoder()).slice(0, 5);
  const difere = Array.isArray(m.time) && melhorPvp.length && (m.time.length < melhorPvp.length || melhorPvp.some((p) => !m.time.map(Number).includes(Number(p.id))));
  if (difere && Date.now() - (S.pvpTimeEm ?? 0) > 3600_000) {
    S.pvpTimeEm = Date.now();
    const ok = melhorPvp;
    if (ok.length) { log(`pvp: salvando o time ${ok.map((p) => `${p.nome} Nv${p.level}`).join(', ')}`); S.depurarAte = Date.now() + 15_000; enviar({ t: 'pvp.time.salvar', pokemonIds: ok.map((p) => p.id) }); setTimeout(() => { S.ultimoPvp = 0; }, 5000); }
    return;
  }
  if (Array.isArray(m.time) && m.time.length && S.eu?.automation && !S.eu.automation.pvpAutoFila && S.eu.loja?.vip !== false && !S.pvpFilaTentada) {
    S.pvpFilaTentada = true; log('pvp: ligando a fila automática (VIP)'); S.depurarAte = Date.now() + 15_000;
    enviar(pacoteAuto(S.eu.automation, { pvpAutoFila: true }));
  }
}
const tentadosSd = new Set();
// guarda a última resposta bruta de cada torneio em torneios/ (só leitura, para estudar resultados)
function guardarTorneio(nome, m) { try { const d = join(AQUI, "torneios"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${nome}.json`), JSON.stringify(m, null, 1)); } catch {} }
function aoShowdown(m) {
  guardarTorneio(m.acao ? `showdown-${m.acao}` : m.recusa ? 'showdown-recusa' : m.evento?.id ? `showdown-${m.evento.id}` : 'showdown', m);
  if (m.recusa) { log('showdown: recusado —', m.recusa); return; }
  if (m.acao === 'inscreveu') { log('showdown: inscrito!'); return; }
  if (m.acao) { log('showdown:', m.acao); return; }
  // inscrito sem equipe = W.O.: monta a equipe (até 5; sem shiny, P5, lendário nem espécie da Outland, ids 2000+)
  const C = m.campeonato;
  if (C?.id && C.tipo === 'showdown' && m.eu?.inscrito && C.equipeAberta && equipeTorneioRuim(m.eu.equipe?.ids) && S.sdEquipeTentada !== C.id + assinaturaAoe()) {
    S.sdEquipeTentada = C.id + assinaturaAoe();
    const ok = [...S.pokemons.values()].filter((p) => !p.shiny && !(p.potencia >= 5) && !p.legendary && !p.lendario && !(p.speciesId >= 2000) && !temAoe(p))
      .sort(porPoder(150)).slice(0, 5);
    if (ok.length) { log(`showdown: montando a equipe de ${C.id}: ${ok.map((p) => `${p.nome} Nv${p.level}`).join(', ')}`); S.depurarAte = Date.now() + 15_000; enviar({ t: 'showdown.equipe', id: C.id, pokemonIds: ok.map((p) => p.id) }); setTimeout(() => enviar({ t: 'showdown.info' }), 5000); }
  }
  const lv = S.eu?.level ?? 0; const agora = Date.now();
  for (const E of m.lista ?? []) {
    if (!E?.id || E.tipo !== 'showdown') continue;
    const janelaOk = Number(E.inscricoesDe) <= agora && agora <= Number(E.inscricoesAte);
    const min = E.nivelMin ?? 100;
    const inscrito = E.inscrito === true || E.eu?.inscrito === true || E.eu?.seed != null;
    const resumo = `showdown ${E.dia ?? E.id}: nível ${min}+, ${janelaOk ? 'inscrições abertas' : 'fora da janela'}${inscrito ? ', já inscrito' : ''}`;
    if (!S.sdVistos?.has(resumo)) { (S.sdVistos ??= new Set()).add(resumo); log(resumo); }
    if (inscrito || !janelaOk || lv < min || tentadosSd.has(E.id)) continue;
    tentadosSd.add(E.id);
    log(`showdown: inscrevendo em ${E.dia ?? E.id}`);
    enviar({ t: 'showdown.inscrever', id: E.id });
  }
}
// poder na arena (PvP, campeonato, Showdown): o nível acima de 150 é comprimido em 150×(n/150)^0,45; os stats
// crescem em linha com o nível, então valem stats × (nível da arena / nível). Poder ≈ dano × vida × defesa.
// (fórmula do pokeidle-manager-online, pvp_power.py; sem o golpe, que não temos no catálogo)
function poderArena(p, teto = null) {
  const n = Math.max(1, Number(p?.level) || 1);
  const la = teto ? Math.min(n, teto) : (n <= 150 ? n : Math.max(150, Math.round(150 * (n / 150) ** 0.45)));
  const st = p?.stats ?? {}; const f = la / n;
  const atk = Math.max(Number(st.atk) || 0, Number(st.spAtk) || 0) * f;
  const dfn = ((Number(st.def) || 0) + (Number(st.spDef) || 0)) / 2 * f;
  const hp = Math.max(24, (Number(st.hp) || 0) * f * 12);
  return ((2 * la) / 5 + 2) * atk * hp * dfn;
}
const porPoder = (teto) => (x, y) => poderArena(y, teto) - poderArena(x, teto);
// pokemon com TM AoE não luta em campeonato nem Showdown (guia Campeonatos e Showdown)
const temAoe = (p) => !!(p?.tmAoe || p?.aoe);
const assinaturaAoe = () => ':' + [...S.pokemons.values()].filter(temAoe).map((p) => p.id).join(',');
const equipeTorneioRuim = (ids) => !Array.isArray(ids) || !ids.length || ids.some((id) => { const p = S.pokemons.get(id); return !p || temAoe(p); });
function aoCampeonato(m) {
  guardarTorneio(m.andou ? 'campeonato-andou' : m.fita ? 'campeonato-fita' : 'campeonato', m);
  if (m.recusa) { log('campeonato: recusado —', m.recusa); return; }
  if (m.andou || m.fita) return;
  if (m.acao === 'inscreveu') { log(`campeonato: inscrito! seed ${m.eu?.seed ?? '?'}`); setTimeout(() => enviar({ t: 'campeonato.info', id: null }), 5000); return; }
  if (m.acao) { log('campeonato:', m.acao); return; }
  const C = m.campeonato; if (!C?.id) return;
  const inscrito = m.eu?.inscrito === true || m.eu?.seed != null;
  const lv = S.eu?.level ?? 0; const agora = Date.now();
  const janelaOk = (!C.inscricoesDe || agora >= Number(C.inscricoesDe)) && (!C.inscricoesAte || agora <= Number(C.inscricoesAte));
  const nivelOk = lv >= (C.nivelMin ?? 0) && (!C.nivelMax || lv <= C.nivelMax);
  const resumo = `${C.nome ?? C.id}: nível ${C.nivelMin ?? 0}${C.nivelMax ? `-${C.nivelMax}` : '+'}, ${janelaOk ? 'inscrições abertas' : 'fora da janela de inscrição'}${inscrito ? ', já inscrito' : ''}`;
  if (S.ultimoResumoCamp !== resumo) { S.ultimoResumoCamp = resumo; log('campeonato:', resumo); }
  // inscrito sem equipe (ou com pokemon de AoE) = W.O.: monta com os 5 de maior nível que podem lutar
  if (inscrito && C.equipeAberta !== false && equipeTorneioRuim(m.eu?.equipe?.ids) && S.campEquipeTentada !== C.id + assinaturaAoe()) {
    S.campEquipeTentada = C.id + assinaturaAoe();
    const R = C.restricoes ?? {};
    const ok = [...S.pokemons.values()].filter((p) => !temAoe(p) && !(R.semShiny && p.shiny) && !(R.semP5 && p.potencia >= 5) && !(R.semLendario && (p.legendary || p.lendario)))
      .sort(porPoder()).slice(0, 5);
    if (ok.length) { log(`campeonato: montando a equipe de ${C.nome ?? C.id}: ${ok.map((p) => `${p.nome} Nv${p.level}`).join(', ')}`); S.depurarAte = Date.now() + 15_000; enviar({ t: 'campeonato.equipe', id: C.id, pokemonIds: ok.map((p) => p.id) }); setTimeout(() => enviar({ t: 'campeonato.info', id: null }), 5000); }
  }
  if (inscrito || C.temSenha || !janelaOk || !nivelOk || tentadosCamp.has(C.id)) return;
  tentadosCamp.add(C.id);
  log(`campeonato: inscrevendo em ${C.nome ?? C.id}`);
  enviar({ t: 'campeonato.inscrever', id: C.id });
}

// ---------- preços do Radar (radar-pokeidle.github.io, público) ----------
const RADAR = { hist: null, anuncios: [], em: null };
async function carregarRadar() {
  try {
    const pegar = async (f) => { const r = await fetch(`https://radar-pokeidle.github.io/dados/${f}.json`); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); };
    const h = await pegar('historico');
    const m = await pegar('mercado');
    RADAR.hist = h.especies ?? null;
    RADAR.anuncios = (m.mercado?.anuncios ?? []).filter((a) => a.shiny).map((a) => ({ nome: a.nome, nivel: a.nivel, nota: a.nota, potencia: a.potencia, preco: a.preco }));
    RADAR.em = h.geradoEm ?? new Date().toISOString();
    mkdirSync(join(AQUI, 'mercado'), { recursive: true });
    writeFileSync(join(AQUI, 'mercado', 'radar-historico.json'), JSON.stringify(h));
    log(`Radar: ${Object.keys(RADAR.hist ?? {}).length} espécies com histórico, ${RADAR.anuncios.length} shiny anunciados agora`);
  } catch (e) { log('Radar indisponível:', e.message); }
}
const mediana = (v) => { const a = v.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
const taxaGemasPokemon = (p) => (p <= 500 ? 0.13 : p <= 5000 ? 0.10 : 0.075);
// Preço sugerido de um shiny: mediana dos últimos 14 dias (Radar), as nossas coletas como reserva,
// e um pouco abaixo do anúncio aberto mais barato da mesma espécie, sem descer de 80% da mediana.
function precoShiny(nome) {
  const out = { nome, mediana14d: null, vendas14d: 0, menorAnuncio: null, anunciosAbertos: 0, sugerido: null, liquido: null, usd: null, base: '' };
  const serie = (RADAR.hist?.[nome]?.shiny ?? []).slice(-14);
  if (serie.length) { const pesos = serie.flatMap((d) => Array(Math.max(1, d.vendas ?? 1)).fill(d.mediana)); out.mediana14d = mediana(pesos); out.vendas14d = serie.reduce((t, d) => t + (d.vendas ?? 0), 0); }
  if (out.mediana14d == null) {
    try {
      const arqs = readdirSync(join(AQUI, 'mercado')).filter((f) => f.startsWith('coleta-')).sort().slice(-8);
      const precos = arqs.flatMap((f) => JSON.parse(readFileSync(join(AQUI, 'mercado', f), 'utf8')).respostas.filter((r) => r.aba === 'historicoGlobal').flatMap((r) => r.linhas))
        .filter((l) => l.tipo === 'pokemon' && l.moeda === 'orb' && l.ficha?.shiny && l.ficha?.nome === nome).map((l) => l.bruto);
      if (precos.length) { out.mediana14d = mediana(precos); out.vendas14d = precos.length; }
    } catch {}
  }
  const abertos = RADAR.anuncios.filter((a) => a.nome === nome).map((a) => a.preco).filter((p) => p > 0);
  out.anunciosAbertos = abertos.length; out.menorAnuncio = abertos.length ? Math.min(...abertos) : null;
  const base = out.mediana14d ?? out.menorAnuncio;
  if (base) {
    out.sugerido = out.menorAnuncio && out.mediana14d ? Math.max(Math.round(out.mediana14d * 0.8), Math.min(out.mediana14d, out.menorAnuncio - 1)) : base;
    out.liquido = snLiquido(out.sugerido);
    out.usd = (out.liquido * 0.009).toFixed(2);
    out.base = out.mediana14d ? `mediana de ${out.vendas14d} vendas recentes ${out.mediana14d.toLocaleString('pt-BR')}${out.menorAnuncio ? `, anúncio mais barato ${out.menorAnuncio.toLocaleString('pt-BR')}` : ''}` : `anúncio mais barato ${out.menorAnuncio.toLocaleString('pt-BR')}`;
  }
  return out;
}

// ---------- bosses automáticos (Nv 3.100+) ----------
// Abaixo do Nv 3.100 o token vale mais vendido (~4 Gemas) do que usado (~2 Gemas de prêmio esperado).
function cuidarDosBosses() {
  if (!CFG.bosses || !S.eu || !S.bossesCatalogo || Date.now() - (S.ultimoBoss ?? 0) < 60_000) return;
  const lv = S.eu.level ?? 0; const tokens = S.eu.items?.[70000] ?? 0; const b = S.eu.boss ?? {};
  if (b.auto && tokens <= CFG.tokenReserva) { S.ultimoBoss = Date.now(); log(`boss: parando o auto (sobrou ${tokens} token para a raid)`); return enviar({ t: 'boss.auto', ativo: false, key: b.autoKey }); }
  if (lv < CFG.bossNivelMin || b.auto || b.arena || tokens <= CFG.tokenReserva) return;
  const alvo = [...S.bossesCatalogo].filter((x) => (x.minNivelTreinador ?? x.level ?? Infinity) <= lv).sort((x, y) => (y.minNivelTreinador ?? 0) - (x.minNivelTreinador ?? 0))[0];
  if (!alvo) return;
  S.ultimoBoss = Date.now();
  log(`boss: auto em ${alvo.name} (${alvo.regiao}, Nv ${alvo.minNivelTreinador}) com ${tokens} tokens, guardando ${CFG.tokenReserva}`);
  enviar({ t: 'boss.auto', ativo: true, key: alvo.key });
}

// ---------- raid semanal (1 token; inscrição de terça 12:00 a segunda 16:00, Brasília) ----------
function semanaDaRaid(t = new Date()) {
  // horário local do PC = Brasília; janela abre terça 12:00 e fecha segunda 16:00
  const d = new Date(t); const dia = d.getDay(); // 0 dom .. 6 sáb
  const ini = new Date(d); ini.setHours(12, 0, 0, 0); ini.setDate(d.getDate() - ((dia - 2 + 7) % 7)); // última terça 12:00
  if (ini > d) ini.setDate(ini.getDate() - 7);
  const fim = new Date(ini); fim.setDate(ini.getDate() + 6); fim.setHours(16, 0, 0, 0); // segunda 16:00
  return { chave: chaveDia(ini), aberta: d >= ini && d <= fim };
}
function cuidarDaRaid() {
  if (!CFG.raid || !S.eu || Date.now() - (S.ultimaRaid ?? 0) < 3600_000) return;
  const sem = semanaDaRaid(); const tokens = S.eu.items?.[70000] ?? 0;
  ACUM.raid ??= {};
  if (!sem.aberta || ACUM.raid[sem.chave] || tokens < 1) return;
  S.ultimaRaid = Date.now();
  ACUM.raid[sem.chave] = 'tentado';
  log(`raid: inscrevendo na semana de ${sem.chave} (1 token)`);
  enviar({ t: 'raid.info' });
  enviar({ t: 'raid.inscrever' });
}
function aoRaid(m) {
  if (m.recusa) { log('raid: recusado —', m.recusa); return; }
  if (!S.raidVisto) { S.raidVisto = true; log('raid:', JSON.stringify(m).slice(0, 300)); }
  if (m.acao === 'inscreveu' || m.inscrito === true) { const sem = semanaDaRaid(); ACUM.raid ??= {}; ACUM.raid[sem.chave] = 'inscrito'; }
}

// ---------- estatísticas acumuladas (sobrevivem a reinícios) ----------
const ARQ_STATS = join(AQUI, 'stats.json');
const ACUM = (() => {
  try { return JSON.parse(readFileSync(ARQ_STATS, 'utf8')); } catch {}
  return { desde: new Date().toISOString(), segundosOnline: 0, abates: 0, desmaios: 0, bolasConfirmadas: 0, bolasSucesso: 0, capturas: 0, shinyCapturados: 0, shinyNoCampo: 0, porBola: {}, drops: {} };
})();
let acumTick = Date.now();
// dia local (o PC está no horário de Brasília)
function chaveDia(t = new Date()) { return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
function hoje() {
  ACUM.dias ??= {};
  return (ACUM.dias[chaveDia()] ??= { segundosOnline: 0, abates: 0, desmaios: 0, capturas: 0, shiny: 0, shinyCampo: 0, bolas: 0, ouroExtra: 0, drops: {} });
}
// conta do dia a partir de quando o bot começou a somar as compras (o painel mostra "desde HH:MM")
function contaDoDia() {
  if (S.eu?.level == null) return null;
  const d = hoje();
  return (d.comp ??= { em: Date.now(), seg0: d.segundosOnline, ouro0: S.eu.gold ?? 0, extra0: d.ouroExtra ?? 0, vendas0: d.vendas ?? 0, cap0: d.capturas, abates0: d.abates, bolas0: d.bolas, bolasOuro: 0, pocoesOuro: 0, outrosOuro: 0 });
}
// avisos: lista do painel (sobrevive a reinícios) e, quando pedido, o celular
function aviso(tipo, titulo, detalhe = '', celular = false) {
  (ACUM.avisos ??= []).unshift({ em: Date.now(), tipo, titulo, detalhe });
  ACUM.avisos.length = Math.min(ACUM.avisos.length, 40);
  return celular ? avisarCelular(tipo, titulo, detalhe || titulo) : Promise.resolve();
}
function resumoDeOntem() {
  const o = new Date(Date.now() - 86_400_000), k = chaveDia(o), d = ACUM.dias?.[k];
  if (!CFG.ntfyTopico || !d || ACUM.resumoEnviado === k) return;
  ACUM.resumoEnviado = k;
  const farm = (d.ouroFim ?? 0) - (d.ouroIni ?? 0) - (d.ouroExtra ?? 0);
  aviso('resumo', 'Resumo de ontem', `Nv ${d.nivelIni ?? '?'} → ${d.nivelFim ?? '?'} · ouro ${farm.toLocaleString('pt-BR')} · ${d.capturas} capturas · ${d.shiny} shiny`, true);
}
function escreverHistorico() {
  const fmt = (v) => Number(v ?? 0).toLocaleString('pt-BR');
  const linhas = Object.entries(ACUM.dias ?? {}).sort(([a], [b]) => b.localeCompare(a)).map(([dia, d]) => {
    const farm = (d.ouroFim ?? 0) - (d.ouroIni ?? 0) - (d.ouroExtra ?? 0);
    const drops = Object.entries(d.drops ?? {}).sort((a, b) => b[1] - a[1]).map(([n, q]) => `${n} ${q}`).join(', ') || '—';
    return `| ${dia} | ${(d.segundosOnline / 3600).toFixed(1)} | ${d.nivelIni ?? '?'} → ${d.nivelFim ?? '?'} | ${fmt(farm)} | ${fmt(d.vendas)} | ${fmt(d.ouroExtra)} | ${fmt(d.abates)} | ${fmt(d.desmaios)} | ${fmt(d.bolas)} | ${fmt(d.capturas)} | ${fmt(d.shiny)} (${fmt(d.shinyCampo)} no campo) | ${drops} |`;
  });
  const txt = `# Histórico do PokeIdle bot\n\nGerado pelo bot a partir de stats.json (atualiza a cada minuto). "Ouro do farm" é a variação do ouro sem os prêmios. Ele inclui as "Vendas", que é o que a Auto Venda pagou pelas capturas. O ouro gasto em bolas, poções e pedras já está descontado.\n\n| Dia | Horas online | Nível | Ouro do farm | Vendas | Prêmios | Abates | Desmaios | Bolas confirmadas | Capturas | Shiny | Drops |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n${linhas.join('\n')}\n`;
  try { writeFileSync(join(AQUI, 'historico.md'), txt); } catch {}
}

function salvarAcum() {
  const agora = Date.now();
  const seg = Math.round((agora - acumTick) / 1000);
  if (S.ws?.readyState === 1) { ACUM.segundosOnline += seg; hoje().segundosOnline += seg; }
  acumTick = agora;
  if (S.eu?.level != null) { const d = hoje(); d.nivelIni ??= S.eu.level; d.nivelFim = S.eu.level; d.ouroIni ??= S.eu.gold ?? 0; d.ouroFim = S.eu.gold ?? 0; }
  contaDoDia(); resumoDeOntem();
  escreverHistorico();
  try { writeFileSync(ARQ_STATS, JSON.stringify(ACUM, null, 1)); } catch {}
}
setInterval(salvarAcum, 60_000);
process.on('exit', salvarAcum);

// ---------- aviso de shiny: log, shinies.log, painel e notificação do Windows ----------
function avisarShiny(tipo, titulo, texto, dados = {}) {
  const a = { em: Date.now(), tipo, titulo, texto, ...dados };
  S.alertas.unshift(a); S.alertas.length = Math.min(S.alertas.length, 50);
  log(titulo + ' — ' + texto);
  if (tipo !== 'teste') aviso(tipo, titulo, texto);
  try { appendFileSync(join(AQUI, 'shinies.log'), JSON.stringify({ ...a, quando: new Date(a.em).toLocaleString('pt-BR') }) + '\n'); } catch {}
  avisarCelular(tipo, titulo, texto);
  if (!CFG.avisoWindows) return;
  try {
    if (process.platform === 'darwin') {
      // Mac: o texto vai como argumento do script (não é montado dentro do comando)
      spawn('osascript', ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"\nend run', titulo, texto], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(AQUI, 'aviso.ps1')], {
        env: { ...process.env, AVISO_TITULO: titulo, AVISO_TEXTO: texto }, detached: true, stdio: 'ignore', windowsHide: true,
      });
      p.unref();
    } else {
      spawn('notify-send', [titulo, texto], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    }
  } catch (e) { log('aviso na tela falhou:', e.message); }
}

function avisarCelular(tipo, titulo, texto) {
  if (!CFG.ntfyTopico) return Promise.resolve();
  const prioridade = tipo === 'capturado' || tipo === 'caiu' ? 5 : tipo === 'campo' || tipo === 'escapou' ? 4 : 3;
  return fetch('https://ntfy.sh/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: CFG.ntfyTopico, title: titulo, message: texto, priority: prioridade, tags: ['sparkles'] }),
  }).then((r) => { if (!r.ok) log('aviso no celular falhou: HTTP', r.status); }).catch((e) => log('aviso no celular falhou:', e.message));
}

// ---------- coleta do Mercado (só leitura) ----------
// Pedidos de leitura iguais aos da tela do Mercado; nada é anunciado, comprado ou cancelado.
const PEDIDO_POKEMON = { tipo: 'pokemon', busca: '', ordem: 'recentes', criterios: [], elementos: [], tiposUnidos: true, categoria: '', soShiny: false, soP5: false, soMega: false, soLendario: false, soTmElemental: false, soTmAoe: false, semOutland: false, pagina: 0, especieId: 0 };
let COLETA = null;
function coletarMercado(motivo = 'manual') {
  if (COLETA || S.ws?.readyState !== 1) return false;
  COLETA = { inicio: new Date().toISOString(), motivo, respostas: [] };
  let seq = 1;
  const pedidos = [{ t: 'market.medias' }];
  for (let p = 0; p < 6; p++) pedidos.push({ t: 'market.historicoGlobal', pagina: p, seq: seq++ });
  for (let p = 0; p < 4; p++) pedidos.push({ t: 'market.historicoGlobal', pagina: p, seq: seq++, tipo: 'pokemon', moeda: 'orb', soShiny: 1 });
  for (let p = 0; p < 4; p++) pedidos.push({ t: 'market.historicoGlobal', pagina: p, seq: seq++, tipo: 'item' });
  pedidos.push({ t: 'market.historicoGlobal', pagina: 0, seq: seq++, tipo: 'saque' });
  pedidos.push({ t: 'market.listar', ...PEDIDO_POKEMON, moeda: 'orb', soShiny: true });
  pedidos.push({ t: 'market.listar', ...PEDIDO_POKEMON, moeda: 'orb' });
  pedidos.push({ t: 'market.itens', elementos: [], categoria: '' });
  log(`coletando Mercado (${pedidos.length} pedidos, só leitura)`);
  for (const p of pedidos) enviar(p, { forcar: true });
  setTimeout(() => {
    try {
      mkdirSync(join(AQUI, 'mercado'), { recursive: true });
      const arq = join(AQUI, 'mercado', `coleta-${COLETA.inicio.replace(/[:.]/g, '-')}.json`);
      writeFileSync(arq, JSON.stringify(COLETA));
      log(`Mercado: ${COLETA.respostas.length} respostas salvas em mercado/${arq.split(/[\\/]/).pop()}`);
    } catch (e) { log('falha ao salvar coleta do Mercado:', e.message); }
    COLETA = null;
  }, pedidos.length * 400 + 15_000);
  return true;
}

function salvarToken(token) {
  try {
    const p = join(AQUI, '.env');
    const txt = readFileSync(p, 'utf8');
    writeFileSync(p, /^POKEIDLE_TOKEN=.*$/m.test(txt) ? txt.replace(/^POKEIDLE_TOKEN=.*$/m, `POKEIDLE_TOKEN=${token}`) : `${txt}\nPOKEIDLE_TOKEN=${token}\n`);
    log('token renovado pelo servidor e salvo no .env');
  } catch (e) { log('token renovado, mas não consegui salvar no .env:', e.message); }
}

// ---------- painel ao vivo (só em 127.0.0.1) ----------
// tempo e abates desde que entrou na hunt atual (zera quando a hunt muda)
// tempo conectado desde que o bot ligou (sem as quedas)
function onlineMs() { return Math.max(0, Date.now() - S.stats.inicio - (S.stats.offMs ?? 0) - (S.offDesde ? Date.now() - S.offDesde : 0)); }
function huntSessao() {
  const slug = S.eu?.huntSlug ?? null;
  if (slug == null && S.huntSessao) return S.huntSessao; // ir ao Centro não zera "nesta hunt"
  if (!S.huntSessao || S.huntSessao.slug !== slug) S.huntSessao = { slug, desde: Date.now(), abates: 0 };
  return S.huntSessao;
}

// o que está equipado: a primeira da lista das automações que ainda tem estoque
function equipados(e) {
  const a = e.automation ?? {};
  const pocao = (a.potionIds ?? []).find((id) => (e.items?.[id] ?? 0) > 0) ?? null;
  const porTaxa = [...(S.bolas ?? [])].sort((x, y) => y.catchRate - x.catchRate).map((b) => b.id);
  const bola = [...(a.ballIds ?? []), ...porTaxa].find((id) => (e.balls?.[id] ?? 0) > 0) ?? null;
  return { pocao, pocaoQtd: pocao ? e.items[pocao] : 0, bola, bolaQtd: bola ? e.balls[bola] : 0 };
}

function instantaneo() {
  const e = S.eu ?? {};
  const hs = huntSessao();
  const horas = Math.max(1 / 60, onlineMs() / 3600_000);
  const xpAgora = e.level ? xpAtualDe(e) : 0;
  const hunt = S.hunts.find((h) => h.slug === e.huntSlug);
  return {
    agora: Date.now(), conectado: S.ws?.readyState === 1, somenteLer: CFG.somenteLer,
    nick: CFG.nick, nivel: e.level, xpNivel: e.xpNivel, xpProximo: e.xpProximo, xp: e.xp, progresso: progressoNivel(e), ouro: e.gold, diamantes: e.diamonds, orbs: e.orbs,
    hunt: hunt ? { nome: hunt.nome, nivel: hunt.nivel, area: hunt.area } : null, noCentro: !!e.noCentro, outlandTier: e.outlandTier,
    xph: Math.round((xpAgora - (S.stats.xp0 ?? xpAgora)) / horas), ouroh: Math.round(((e.gold ?? 0) - (S.stats.ouro0 ?? 0) - (S.stats.ouroExtra ?? 0)) / horas), ouroExtra: S.stats.ouroExtra ?? 0,
    stats: S.stats, minutos: Math.round(onlineMs() / 60000), sniperPk: snPainel(),
    equipe: equipe().sort((a, b) => a.slot - b.slot).map((p) => ({ nome: p.nome, nv: p.level, hp: p.hp, mhp: p.maxHp, shiny: p.shiny, q: p.quality, p: p.potencia, nota: p.nota, ativo: p.id === e.activeId, lt: (p.shiny && p.lookShiny) || ESPECIES.get(p.speciesId)?.looktype || LOOK_POR_NOME.get(p.nome) || null })),
    bonus: (() => {
      const l = e.loja ?? {}; const agora = Date.now(); const min = (ate) => Math.max(0, Math.round(((Number(ate) || 0) - agora) / 60000));
      return {
        vip: !!l.vip, vipMin: l.vip ? min(l.vipAte) : 0, vipPermanente: !!l.vipPermanente,
        passeVipMin: min(e.passe?.vipAte),
        boosts: Object.fromEntries(Object.entries(l.boosts ?? {}).map(([k, ate]) => [k, min(ate)]).filter(([, m]) => m > 0)),
        pausados: Object.fromEntries(Object.entries(l.boostsPausados ?? {}).filter(([, r]) => Number(r) > 0).map(([k, r]) => [k, Math.round(Number(r) / 60000)])),
        guildPct: e.guildBonusPct ?? e.guild?.bonusPct ?? 0,
      };
    })(),
    totalPokemons: S.pokemons.size,
    atrasados: { alvo: e.loja?.alvoAtrasados ?? null, ativo: e.loja?.atrasados ?? null, xp: xpAtualDe(e) },
    huntSessao: { desde: hs.desde, abates: hs.abates }, abatesh: Math.round(S.stats.abates / horas), equipado: equipados(e),
    bolas: e.balls ?? {}, itens: e.items ?? {},
    nomesItens: Object.fromEntries([...ITEM_POR_NOME].filter(([, id]) => (e.items ?? {})[id] > 0).map(([nome, id]) => [id, nome])),
    posicoes: [...S.mobs.values()].map((m) => ({ s: m.slot, c: m.c, r: m.r, tr: !!m.treinador, ns: !!m.naoSelvagem, x: !!m.morto, n: m.nome })),
    campo: (S.mobs.size ? [...S.mobs.values()].filter((m) => !m.treinador) : [...(S.vista ?? new Map()).values()].map((x) => ({ ...x, nome: x.nome ?? hunt?.nome, nivel: hunt?.nivel }))).map((m) => ({ nome: m.nome, nv: m.nivel, hp: m.hp, mhp: m.mhp, morto: !!m.morto, shiny: !!m.shiny, lt: LOOK_POR_NOME.get(m.nome) ?? null, slot: m.slot })),
    lives: ['twitch', 'kick'].map((k) => {
      const x = e[k] ?? {};
      return {
        plataforma: k, vinculado: !!x.vinculado, login: x.login ?? null, pct: x.pct ?? 15,
        bonus: Object.fromEntries(['xp', 'captura', 'shiny'].map((tp) => [tp, Math.max(0, Math.round(((Number(x.bonus?.[tp]) || 0) - Date.now()) / 60000))])),
        noAr: (Array.isArray(x.oficiais) ? x.oficiais : []).filter((o) => o?.aoVivo && o?.ativo).map((o) => o.login ?? o.nome ?? o.canal ?? '?'),
      };
    }),
    drops: [...S.drops.entries()].sort((a, b) => b[1] - a[1]),
    capturados: S.capturados,
    alertas: S.alertas,
    acumulado: ACUM,
    treinadorLt: e.loja?.looktype ?? ((e.loja?.gender === 'female') ? (e.loja?.vip ? 264 : 160) : (e.loja?.vip ? 263 : 159)),
    extras: extrasPainel(e),
  };
}

// campos só de leitura que o painel mostra (evento, PvP, moedas, dia do tipo, Pokédex…)
// gemas que os drops dos últimos 7 dias renderiam por mês, ao preço médio do Mercado e já sem a taxa (teto)
function gemasPorMes() {
  const P = S.precos; if (!P) return null;
  const dias = Object.entries(ACUM.dias ?? {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
  let total = 0, seg = 0;
  for (const [, d] of dias) {
    seg += d.segundosOnline ?? 0;
    for (const [nome, q] of Object.entries(d.drops ?? {})) { const o = P.medias[ITEM_POR_NOME.get(nome)]?.orb; if (o?.media > 0 && o.unidades >= 10) total += q * o.media; }
  }
  if (seg < 3600) return null;
  const mes = total * 0.85 / seg * 30 * 86400;
  return { mes: Math.round(mes), usd: +(mes * 0.009).toFixed(2), horas: Math.round(seg / 3600), dias: dias.length };
}
// bosses lendários (copiado de shared/bosses-lendarios.mjs do jogo): trio da maior região liberada
const BOSS_REGIOES = [
  { nome: 'Kanto', nivel: 300, ids: [144, 146, 145] }, { nome: 'Johto', nivel: 650, ids: [245, 244, 243] },
];
function bossesPainel(e) {
  if (!ESPECIES.size) return null;
  const nv = e.level ?? 0, par = nv >= 650 ? 1 : 0, reg = BOSS_REGIOES[par];
  const chave = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const dia = (((Math.round((Date.parse(chave) - Date.parse('2026-11-17')) / 86_400_000)) % 3) + 3) % 3;
  const at = S.pokemons.get(e.activeId), meu = ESPECIES.get(at?.speciesId);
  const lista = reg.ids.map((id, pos) => {
    const b = ESPECIES.get(id); if (!b) return null;
    const meus = meu ? [meu.type1, meu.type2].filter(Boolean) : [], dele = [b.type1, b.type2].filter(Boolean);
    const dano = meu ? Math.max(...meus.map((t) => efetividade(t, b.type1, b.type2))) : null;
    const leva = meu ? Math.max(...dele.map((t) => efetividade(t, meu.type1, meu.type2))) : null;
    const premio = ['tm', 'mega', 'tickets'][(((pos - dia) % 3) + 3) % 3];
    return { nome: b.nome, lt: b.looktype, tipos: dele, dano, leva, premio, chance: premio === 'tm' ? 0.5 * (par + 1) : premio === 'mega' ? 0.65 * (par + 1) : null };
  }).filter(Boolean);
  return { regiao: reg.nome, nivelMin: reg.nivel, liberado: nv >= reg.nivel, lista,
    equipe: equipe().sort((a, b) => b.level - a.level).map((p) => ({ nome: p.nome, nv: p.level, pronto: p.level >= reg.nivel })) };
}
function configPainel() {
  const ip = CFG.painelRede && S.painelNaRede ? Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address : null;
  return { ntfy: !!CFG.ntfyTopico, rede: !!S.painelNaRede, url: ip ? `http://${ip}:${CFG.painelPorta}` : null };
}
function extrasPainel(e) {
  const dex = Object.values(e.pokedex ?? {});
  return {
    evento: e.evento ? { xpTr: e.evento.xpTreinadorPct, xpPk: e.evento.xpPokemonPct, terminaEm: e.evento.terminaEm } : null,
    bonusXp: e.bonusXp ? { tr: e.bonusXp.tr, partes: (e.bonusXp.partes ?? []).map((p) => ({ id: p.id, tr: p.tr, ate: p.ate })) } : null,
    pvp: e.pvp ? { posicao: e.pvp.posicao, vitorias: e.pvp.vitorias, derrotas: e.pvp.derrotas, partidas: e.pvp.partidas, sequencia: e.pvp.sequencia, pico: e.pvp.pico, pontos: e.pvp.pontos, tier: e.pvp.tierId } : null,
    coroas: e.pkCoroa ?? null, medalhas: e.pkMedalha ?? null,
    passeDegrau: e.passe?.degrau ?? null,
    topCatch: e.topCatch ? { n: e.topCatch.n, m: e.topCatch.m } : null,
    diaSazonal: e.diaSazonal ? { tipo: e.diaSazonal.tipo, fim: e.diaSazonal.fim, ultimos3: e.diaSazonal.ultimos3 ?? [] } : null,
    chocadeira: e.chocadeira ? { total: e.chocadeira.total ?? 0, ovos: (e.chocadeira.ovos ?? []).length } : null,
    casa: e.casa ? { emUso: (e.casa.lista ?? []).length, max: e.casa.maxEmUso ?? 0 } : null,
    bicicleta: !!e.bicicleta?.equipada,
    pokedex: { capturadas: dex.filter((d) => d.c > 0).length, vistas: dex.length, total: [...ESPECIES.keys()].filter((id) => id <= 1025).length || null, abates: dex.reduce((t, d) => t + (d.k ?? 0), 0) },
    tentativas: S.tentativas ?? 0,
    patrimonio: (() => { try { return patrimonio(e); } catch { return null; } })(),
    gemasMes: (() => { try { return gemasPorMes(); } catch { return null; } })(),
    bosses: (() => { try { return bossesPainel(e); } catch { return null; } })(),
    avisos: (ACUM.avisos ?? []).slice(0, 20),
    bolaPreco: Object.fromEntries((S.bolas ?? []).map((b) => [b.id, b.priceGold])),
    config: configPainel(),
  };
}

async function iniciarPainel() {
  const { createServer } = await import('node:http');
  const html = () => { try { return readFileSync(join(AQUI, 'painel.html'), 'utf8'); } catch (e) { return 'painel.html ilegível: ' + e.message; } };
  const falhas = new Map(); // ip → { n, ate }
  const daqui = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const confere = (cab) => { const m = /^Basic (.+)$/.exec(cab ?? ''); if (!m) return false; const dado = Buffer.from(Buffer.from(m[1], 'base64').toString().replace(/^[^:]*:/, '')), certo = Buffer.from(CFG.painelSenha); return dado.length === certo.length && timingSafeEqual(dado, certo); };
  const srv = createServer((req, res) => {
    const ip = req.socket.remoteAddress ?? '';
    if (!daqui(ip)) {
      const f = falhas.get(ip);
      if (f && f.n >= 10 && Date.now() < f.ate) { res.writeHead(429); return res.end('muitas tentativas; espere 10 minutos'); }
      if (!confere(req.headers.authorization)) {
        if (req.headers.authorization) falhas.set(ip, { n: (f && Date.now() < f.ate ? f.n : 0) + 1, ate: Date.now() + 600_000 });
        res.writeHead(401, { 'www-authenticate': 'Basic realm="PokeIdle", charset="UTF-8"' }); return res.end('senha');
      }
      const rota = new URL(req.url, 'http://x').pathname;
      if (req.method !== 'GET' || !['/', '/estado', '/eventos', '/sprite', '/icones'].includes(rota)) { res.writeHead(403); return res.end('pela rede o painel é só leitura'); }
    }
    if (req.url === '/mercado/coletar') { const ok = coletarMercado('painel'); res.writeHead(ok ? 202 : 409, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(ok ? 'coletando' : 'ocupado ou desconectado'); }
    if ((req.url ?? '').startsWith('/resgatar/') && req.method === 'POST') { const codigo = req.url.slice(10).toUpperCase(); if (!/^[A-Z0-9]{4,20}$/.test(codigo)) { res.writeHead(400); return res.end('codigo invalido'); } S.depurarAte = Date.now() + 20_000; log(`resgatar: enviando código de vínculo (${codigo.length} caracteres)`); enviar({ t: 'convite.resgatar', codigo }); res.writeHead(202, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('enviado; veja o log'); }
    // ajustes do sniper (gasta Gemas): só deste PC, só pelo próprio painel. O cabeçalho próprio força o navegador a
    // pedir licença (CORS) antes, e a origem tem de ser o painel; assim outro site aberto no navegador não muda nada.
    if (req.url === '/sniper' && req.method === 'POST') {
      const org = req.headers.origin; const okOrg = !org || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(org);
      if (!daqui(ip) || req.headers['x-painel'] !== '1' || !okOrg || !/json/.test(req.headers['content-type'] ?? '')) { res.writeHead(403); return res.end('só pelo painel deste PC'); }
      let corpo = ''; req.on('data', (d) => { corpo += d; if (corpo.length > 4000) req.destroy(); });
      req.on('end', () => { let r; try { r = snMudar(JSON.parse(corpo)); } catch { r = { ok: false, erros: ['JSON inválido'] }; } res.writeHead(r.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ...r, sniperPk: snPainel() })); });
      return;
    }
    if (req.url === '/vender-reservas' && req.method === 'POST') { const r = venderReservas(); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(r)); }
    if (req.url === '/teste-aviso') { avisarShiny('teste', '✨ Teste: shiny de mentira', 'Só testando o aviso do painel e do Windows.', { nome: 'Teste', level: 0, teste: true }); res.writeHead(200); return res.end('ok'); }
    if (req.url.startsWith('/preco')) { const nome = new URL(req.url, 'http://x').searchParams.get('nome') ?? ''; res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(precoShiny(nome))); }
    if (req.url.startsWith('/sprite')) {
      const lt = Number(new URL(req.url, 'http://x').searchParams.get('lt'));
      if (!Number.isInteger(lt) || lt <= 0) { res.writeHead(400); return res.end('lt?'); }
      spriteDe(lt).then((s) => { res.writeHead(s ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' }); res.end(JSON.stringify(s)); });
      return;
    }
    if (req.url === '/icones') {
      const base = `https://${CFG.host}`, ui = `${base}/assets/site/assets/ui`;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' });
      return res.end(JSON.stringify({ ouro: `${ui}/moeda-ouro.png`, gema: `${base}/img/moeda-gema.png`, generico: `${ui}/menu-bolsa.png`, bolas: { 1: `${ui}/ball-poke.png`, 2: `${ui}/ball-great.png`, 3: `${base}/img/ball-super.png`, 4: `${ui}/ball-ultra.png`, 5: `${base}/img/ball-beast.png` }, itens: ICONES_ITEM }));
    }
    if (req.url === '/estado') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(instantaneo())); }
    if (req.url === '/eventos') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (const l of LOG_BUF.slice(-80)) res.write(`data: ${JSON.stringify(l)}\n\n`);
      SSE.add(res); req.on('close', () => SSE.delete(res)); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html());
  });
  srv.on('error', (e) => log('painel indisponível:', e.message));
  S.painelNaRede = CFG.painelRede && CFG.painelSenha.length >= 8;
  if (CFG.painelRede && !S.painelNaRede) log('PAINEL_REDE=1 ignorado: defina PAINEL_SENHA com 8 caracteres ou mais no .env');
  srv.listen(CFG.painelPorta, S.painelNaRede ? '0.0.0.0' : '127.0.0.1', () => log(`painel ao vivo: http://localhost:${CFG.painelPorta}${S.painelNaRede ? ' (e na rede de casa, só leitura com senha)' : ''}`));
}
iniciarPainel();
if (CFG.manterAcordado && process.platform === 'win32') {
  try {
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(AQUI, 'manter-acordado.ps1')], { env: { ...process.env, BOT_PID: String(process.pid) }, stdio: 'ignore', windowsHide: true }).unref();
    log('PC acordado enquanto o bot rodar (a tela ainda pode apagar)');
  } catch (e) { log('não consegui manter o PC acordado:', e.message); }
} else if (CFG.manterAcordado && process.platform === 'darwin') {
  // Mac: caffeinate -i impede a suspensão por inatividade e sai sozinho quando o bot (-w PID) termina
  try {
    spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
    log('Mac acordado enquanto o bot rodar (caffeinate; a tela ainda pode apagar, e fechar a tampa do notebook ainda suspende)');
  } catch (e) { log('não consegui manter o Mac acordado:', e.message); }
}

process.on('SIGINT', () => { log('encerrando'); resumo(); S.parar = true; S.ws?.close(1000); setTimeout(() => process.exit(0), 300); });
log(`PokeIdle bot — ${CFG.nick}${CFG.somenteLer ? ' (SOMENTE_LER)' : ''} · regiões ${CFG.regioesAuto ? 'auto' : CFG.regioes.join(',')} · captura ${CFG.modoCaptura}`);
conectar();
