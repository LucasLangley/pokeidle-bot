// Régua de compra e de preço do sniper de shinies (Mercado da Comunidade, Gemas).
// Funções puras: nada de I/O, relógio ou aleatoriedade. `vendas` é uma lista de vendas no formato do
// historicoGlobal ({ bruto, em, ficha: { nome, level, potencia, tmAoe, nota, ivTotal, quality } }),
// já filtrada para pokemon shiny em Gemas. `agora` e os horários são em ms.

// ---------- Taxa oficial de venda de pokemon em Gemas (cópia de taxa-mercado-do-jogo) ----------
const FAIXAS_ORB = [{ ate: 500, bp: 1300 }, { ate: 5_000, bp: 1000 }, { ate: Infinity, bp: 750 }];
export function taxaVenda(total) {
  const t = Math.floor(Number(total) || 0);
  if (t <= 0) return 0;
  let piso = 0, bp = 0;
  for (const f of FAIXAS_ORB) { const teto = Math.min(t, f.ate); if (teto <= piso) break; bp += (teto - piso) * f.bp; piso = teto; }
  return Math.min(t, Math.ceil(bp / 10_000));
}
export const liquido = (total) => { const t = Math.floor(Number(total) || 0); return t <= 0 ? 0 : t - taxaVenda(t); };
// Menor preço de anúncio cujo líquido cobre `alvo`.
export function precoParaLiquido(alvo) {
  let lo = 1, hi = Math.max(2, Math.ceil(alvo * 1.2) + 10);
  while (liquido(hi) < alvo) hi *= 2;
  while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (liquido(m) >= alvo) hi = m; else lo = m + 1; }
  return lo;
}

// ---------- Configuração padrão (a recomendada no RELATORIO.md) ----------
export const CFG_PADRAO = {
  metodo: 'loglin',      // 'atual' | 'quantil' | 'loglin' | 'knn'
  janelaDias: 14,
  minVizinhos: 3,        // vendas da mesma espécie/potência/AoE exigidas
  dNota: 0.3,            // régua 'atual'/'quantil': nota a até isto
  quantil: 0.35,         // régua 'quantil'
  k: 5,                  // régua 'knn'
  feats: ['nota', 'lvl'],// régua 'loglin'/'knn': nota, lvl (log nível), iv (ivTotal/31), q (quality)
  estat: 'mediana',      // régua 'loglin': 'mediana' | 'media' | 'quantil' dos log-preços ajustados
  meiaVidaDias: null,    // peso das vendas por idade: 0,5^(idade/meiaVida). null = todas pesam igual
  tendencia: false,      // corrige a tendência de preço da espécie (inclinação no tempo, encolhida por lambdaTend)
  lambdaTend: 20,        // encolhimento da tendência (dias²); maior = mais perto de zero
  tendMax: 0.15,         // teto da tendência, em log-preço por dia
  pesoPreco: 0.35,       // w: quanto o próprio preço do anúncio puxa a revenda esperada (regressão: 0,29, IC95 0,18–0,50, 1.230 vendas)
  desconto: 1.10,        // fator: revenda esperada = fator × ref^(1−w) × preço^w. Calibrado no treino (19–23/11) com o gabarito sem modelo
  margemMin: 0.45,       // lucro previsto mínimo, em fração do preço pago (a que dá mais lucro por Gema no treino)
  lucroMin: 30,          // lucro previsto mínimo em Gemas
  precoMax: 20_000,      // não compra acima disto (cauda com poucos dados)
  // v3 — concorrentes (só valem quando deveComprar recebe a lista; precoRevenda sempre usa)
  concNotaMin: -0.1,     // concorrente "parecido" tem nota ≥ a nossa + isto
  concNivelAbs: 20,      // … e nível a até max(concNivelAbs, concNivelRel × nível)
  concNivelRel: 0.25,
  concAbaixo: 1,         // revenda limitada a (concorrente parecido mais barato − isto)
  // v3 — limpeza do histórico (desligada; ver RELATORIO.md)
  limpaPar: false,       // false | 'reverso' | 'repetido'
  revendaHoras: 0,       // 0 = desligado; senão, peso pesoRevenda para venda de pokemon revendido em até X h
  pesoRevenda: 0.5,
  corteAbsurdo: 0,       // 0 = desligado; senão, fora a venda cujo log-preço ajustado dista mais que isto da mediana
  // v3 — liquidez
  liqMin: 3,             // com menos de liqMin vendas da espécie na faixa de nível (janela), exige margem extra (0 = desligado)
  liqMargemExtra: 0.5,   // soma à margemMin nesses casos (null = não compra). Teste: carteira 510 → 773 Gemas/dia, mesmo erro
  // v3 — lucro por dia (desligado; precisa de cfg.modeloRevenda = revenda/modelo.json → .modelo)
  modeloRevenda: null,
  lucroDiaMin: null,     // fração do preço por dia, ex.: 0.01 = 1%/dia
  horizonteH: 72,        // horas até liquidar o que não vendeu
  liquidacao: 0.53,      // liquida a este × ref (estudo da revenda)
};

// ---------- Utilitários ----------
const pot = (f) => f.potencia ?? 1;
const mesmoTipo = (a, b) => a.nome === b.nome && pot(a) === pot(b) && !!a.tmAoe === !!b.tmAoe;
const quantilDe = (arr, q) => { const s = [...arr].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const mediana = (a) => quantilDe(a, 0.5);
// quantil ponderado (pesos ≥ 0); com pesos iguais coincide com o ponto do meio da lista ordenada
function quantilPond(vals, pesos, q) {
  const o = vals.map((v, i) => [v, pesos[i]]).sort((a, b) => a[0] - b[0]);
  const tot = o.reduce((s, x) => s + x[1], 0); if (!(tot > 0)) return quantilDe(vals, q);
  let acc = 0; for (const [v, w] of o) { acc += w; if (acc >= q * tot - 1e-9) return v; }
  return o.at(-1)[0];
}
const FEAT = {
  nota: (f) => f.nota ?? 0,
  lvl: (f) => Math.log(Math.max(1, f.level ?? 1)),
  iv: (f) => (f.ivTotal ?? 0) / 31,
  q: (f) => f.quality ?? 1,
};
const vetor = (f, feats) => feats.map((k) => FEAT[k](f));
const chaveGrupo = (f) => `${f.nome}|${pot(f)}|${f.tmAoe ? 1 : 0}`;

// Inclinações comuns a todas as espécies (efeito fixo por espécie/potência/AoE, mínimos quadrados com
// leve ridge). É o "pooling": a nota e o nível valem o mesmo tanto em % de preço para todo shiny.
export function inclinacoes(vendas, feats) {
  const grupos = new Map();
  for (const v of vendas) { const k = chaveGrupo(v.ficha); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(v); }
  const p = feats.length, XtX = Array.from({ length: p }, () => Array(p).fill(0)), Xty = Array(p).fill(0);
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const xs = g.map((v) => vetor(v.ficha, feats)), ys = g.map((v) => Math.log(v.bruto));
    const mx = feats.map((_, j) => xs.reduce((s, x) => s + x[j], 0) / xs.length), my = ys.reduce((s, y) => s + y, 0) / ys.length;
    for (let i = 0; i < xs.length; i++) for (let a = 0; a < p; a++) { Xty[a] += (xs[i][a] - mx[a]) * (ys[i] - my); for (let b = 0; b < p; b++) XtX[a][b] += (xs[i][a] - mx[a]) * (xs[i][b] - mx[b]); }
  }
  for (let a = 0; a < p; a++) XtX[a][a] += 0.5; // ridge
  return resolver(XtX, Xty);
}
function resolver(A, b) { // Gauss com pivô
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let m = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[m][c])) m = r;
    [M[c], M[m]] = [M[m], M[c]]; if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

// ---------- Limpeza do histórico (opcional) ----------
// Devolve um peso por venda de `doTipo` (0 = fora). Regras, todas desligadas por padrão:
//  • limpaPar 'reverso': fora a venda A→B se, na janela, também houve alguma venda B→A (ida e volta entre duas contas).
//    'repetido': também fora se o mesmo par A→B aparece 3+ vezes na janela.
//  • revendaHoras: venda de um pokemon que foi vendido de novo (ou antes) em até X h leva peso `pesoRevenda`.
//  • corteAbsurdo (log): depois do ajuste por nota/nível, fora a venda que fica mais de e^corte vezes acima ou
//    abaixo da mediana da espécie (ex.: ln 4 ≈ 1,39 = 4× acima ou abaixo).
// Usa vendedor/comprador só para comparar contas entre si; nada é guardado nem devolvido.
function pesosLimpeza(doTipo, passadas, cfg) {
  const pesos = doTipo.map(() => 1);
  if (cfg.limpaPar) {
    const par = new Map();
    for (const v of passadas) if (v.vendedor && v.comprador) { const k = `${v.vendedor}\u0000${v.comprador}`; par.set(k, (par.get(k) ?? 0) + 1); }
    doTipo.forEach((v, i) => {
      if (!v.vendedor || !v.comprador) return;
      const ida = par.get(`${v.vendedor}\u0000${v.comprador}`) ?? 0, volta = par.get(`${v.comprador}\u0000${v.vendedor}`) ?? 0;
      if (volta > 0 || (cfg.limpaPar === 'repetido' && ida >= 3)) pesos[i] = 0;
    });
  }
  if (cfg.revendaHoras > 0) {
    const porPk = new Map();
    for (const v of passadas) if (v.pokemonId != null) { if (!porPk.has(v.pokemonId)) porPk.set(v.pokemonId, []); porPk.get(v.pokemonId).push(v.em); }
    doTipo.forEach((v, i) => {
      const ts = porPk.get(v.pokemonId) ?? [];
      if (ts.some((t) => t !== v.em && Math.abs(t - v.em) <= cfg.revendaHoras * 3_600_000)) pesos[i] = Math.min(pesos[i], cfg.pesoRevenda);
    });
  }
  return pesos;
}

// ---------- referencia(ficha, vendas, agora) → { ref, n, base, nLiq } ----------
// ref = preço bruto típico de venda de um shiny com esta ficha, só com vendas anteriores a `agora`.
// nLiq = vendas da mesma espécie/potência/AoE na faixa de nível (±max(20, 25%)) dentro da janela (liquidez).
// `cfg.beta` (opcional) evita recalcular as inclinações a cada chamada.
export function referencia(ficha, vendas, agora, cfg = CFG_PADRAO) {
  cfg = { ...CFG_PADRAO, ...cfg };
  const desde = agora - cfg.janelaDias * 86_400_000;
  const passadas = vendas.filter((v) => v.em < agora && v.em >= desde && v.ficha);
  const todas = passadas.filter((v) => mesmoTipo(v.ficha, ficha));
  const p0 = pesosLimpeza(todas, passadas, cfg);
  const doTipo = todas.filter((_, i) => p0[i] > 0), pLimpo = p0.filter((p) => p > 0);
  const fora = todas.length - doTipo.length;
  const perto = doTipo.filter((v) => Math.abs(v.ficha.level - ficha.level) <= Math.max(20, ficha.level * 0.25));
  const nLiq = perto.length;
  if (cfg.metodo === 'atual' || cfg.metodo === 'quantil') {
    const g = perto.filter((v) => Math.abs((v.ficha.nota ?? 0) - (ficha.nota ?? 0)) <= cfg.dNota).map((v) => v.bruto);
    if (g.length < cfg.minVizinhos) return { ref: null, n: g.length, nLiq, base: 'poucas vendas parecidas' };
    return { ref: cfg.metodo === 'atual' ? mediana(g) : quantilDe(g, cfg.quantil), n: g.length, nLiq, base: `${cfg.metodo} de ${g.length} vendas (nota ±${cfg.dNota})` };
  }
  if (doTipo.length < cfg.minVizinhos) return { ref: null, n: doTipo.length, nLiq, base: 'poucas vendas da espécie' };
  const beta = cfg.beta ?? inclinacoes(passadas, cfg.feats);
  const x = vetor(ficha, cfg.feats);
  // preço de cada venda passada "trazido" para a ficha pedida: log p + beta·(x − x_venda)
  const ajust = (v) => Math.log(v.bruto) + vetor(v.ficha, cfg.feats).reduce((s, xv, j) => s + beta[j] * (x[j] - xv), 0);
  if (cfg.metodo === 'knn') {
    const esc = { nota: 0.3, lvl: 0.3, iv: 1, q: 0.15 };
    const d = (v) => cfg.feats.reduce((s, k) => s + Math.abs(FEAT[k](v.ficha) - FEAT[k](ficha)) / esc[k], 0);
    const viz = [...doTipo].sort((a, b) => d(a) - d(b)).slice(0, cfg.k);
    return { ref: Math.exp(mediana(viz.map(ajust))), n: viz.length, nLiq, base: `knn ${viz.length} ajustados` };
  }
  // loglin: cada venda passada da espécie, ajustada para a ficha pedida; resume pela estatística escolhida
  let meu = doTipo.map(ajust);
  let dias = doTipo.map((v) => (agora - v.em) / 86_400_000);
  let pesos = dias.map((d, i) => (cfg.meiaVidaDias ? 0.5 ** (d / cfg.meiaVidaDias) : 1) * pLimpo[i]);
  let absurdas = 0;
  if (cfg.corteAbsurdo > 0 && meu.length > cfg.minVizinhos) {
    const m = mediana(meu), ok = meu.map((y) => Math.abs(y - m) <= cfg.corteAbsurdo);
    absurdas = ok.filter((o) => !o).length;
    if (meu.length - absurdas >= cfg.minVizinhos) { meu = meu.filter((_, i) => ok[i]); dias = dias.filter((_, i) => ok[i]); pesos = pesos.filter((_, i) => ok[i]); }
    else absurdas = 0;
  }
  let tend = 0;
  if (cfg.tendencia && meu.length >= 3) { // log-preço ajustado contra o tempo, encolhido para zero
    const W = pesos.reduce((s, w) => s + w, 0), mt = dias.reduce((s, d, i) => s + pesos[i] * d, 0) / W, my = meu.reduce((s, y, i) => s + pesos[i] * y, 0) / W;
    let sxy = 0, sxx = 0; for (let i = 0; i < meu.length; i++) { sxy += pesos[i] * (dias[i] - mt) * (meu[i] - my); sxx += pesos[i] * (dias[i] - mt) ** 2; }
    tend = Math.max(-cfg.tendMax, Math.min(cfg.tendMax, -sxy / (sxx + cfg.lambdaTend))); // por dia, para frente no tempo
    meu = meu.map((y, i) => y + tend * dias[i]);
  }
  const uniforme = pesos.every((p) => p === 1);
  const q = cfg.estat === 'quantil' ? cfg.quantil : 0.5;
  const mu = cfg.estat === 'media' ? meu.reduce((s, y, i) => s + pesos[i] * y, 0) / pesos.reduce((s, w) => s + w, 0) : (uniforme ? quantilDe(meu, q) : quantilPond(meu, pesos, q));
  const extra = [fora ? `${fora} fora por conta/revenda` : '', absurdas ? `${absurdas} absurdas fora` : '', tend ? `tendência ${(tend * 100).toFixed(1)}%/dia` : ''].filter(Boolean).join(', ');
  return { ref: Math.exp(mu), n: meu.length, nLiq, base: `loglin ${meu.length} vendas da espécie, β=${beta.map((b) => b.toFixed(2)).join('/')}${extra ? `, ${extra}` : ''}` };
}

// ---------- Concorrentes ----------
// "Parecido": mesma espécie, potência e AoE, nível a até max(concNivelAbs, concNivelRel × nível) e nota ≥ a nossa + concNotaMin.
// `concorrentes` são anúncios abertos DE OUTROS (sem o próprio anúncio avaliado): { preco, nome, nivel|level, nota, potencia, aoe|tmAoe }.
export function concorrenteMaisBarato(ficha, concorrentes, cfg = CFG_PADRAO) {
  cfg = { ...CFG_PADRAO, ...cfg };
  let min = Infinity;
  for (const c of concorrentes ?? []) {
    if (!(c.preco > 0) || c.nome !== ficha.nome || (c.potencia ?? 1) !== pot(ficha) || !!(c.aoe ?? c.tmAoe) !== !!ficha.tmAoe) continue;
    if (Math.abs((c.nivel ?? c.level) - ficha.level) > Math.max(cfg.concNivelAbs, ficha.level * cfg.concNivelRel)) continue;
    if ((c.nota ?? 0) < (ficha.nota ?? 0) + cfg.concNotaMin) continue;
    if (c.preco < min) min = c.preco;
  }
  return min;
}

// Chance de vender e tempo esperado até vender, pelo modelo do estudo da revenda (revenda/modelo.json → .modelo):
// { rel: [...], p0: [...], h: [...] } por faixa de preço ÷ ref. P(vender até t h) = 1 − (1 − p0)·e^(−h·t).
export function chanceVenda(rel, modelo, horas) {
  let i = 0; for (let j = 1; j < modelo.rel.length; j++) if (Math.abs(Math.log(rel / modelo.rel[j])) < Math.abs(Math.log(rel / modelo.rel[i]))) i = j;
  const p0 = modelo.p0[i], h = modelo.h[i];
  const P = 1 - (1 - p0) * Math.exp(-h * horas);
  const horasMedias = h > 0 ? ((1 - p0) * (1 - Math.exp(-h * horas))) / h : horas * (1 - p0); // E[min(T, horas)]
  return { P, horasMedias };
}

// ---------- deveComprar(anuncio, vendas, cfg, concorrentes?) → { comprar, lucroPrevisto, motivo } ----------
// anuncio = { preco, ficha, em? }. lucroPrevisto = líquido(revenda) − preço, com
// revenda = desconto × ref^(1−w) × preço^w (o termo em preço corrige a "maldição do vencedor"), limitada a
// (concorrente parecido mais barato − concAbaixo) quando `concorrentes` vier. Sem concorrentes: igual à v2.
// Liquidez: com menos de liqMin vendas da espécie na faixa de nível, exige margemMin + liqMargemExtra
// (ou não compra, se liqMargemExtra for null). Lucro por dia (opcional): com cfg.modeloRevenda, só compra se o lucro
// esperado por dia de Gemas paradas (vendendo ou liquidando a `liquidacao` × ref no fim de `horizonteH`) ≥ lucroDiaMin.
export function deveComprar(anuncio, vendas, cfg = CFG_PADRAO, concorrentes = null) {
  cfg = { ...CFG_PADRAO, ...cfg };
  const agora = anuncio.em ?? Math.max(0, ...vendas.map((v) => v.em)) + 1;
  const preco = anuncio.preco;
  if (!(preco > 0)) return { comprar: false, lucroPrevisto: 0, motivo: 'preço inválido' };
  if (preco > cfg.precoMax) return { comprar: false, lucroPrevisto: 0, motivo: `preço acima de ${cfg.precoMax}` };
  const r = referencia(anuncio.ficha, vendas, agora, cfg);
  if (r.ref == null) return { comprar: false, lucroPrevisto: 0, motivo: r.base, ref: null, nLiq: r.nLiq };
  const w = cfg.pesoPreco ?? 0;
  const pelaRegua = Math.floor(cfg.desconto * Math.exp((1 - w) * Math.log(r.ref) + w * Math.log(preco)));
  let revenda = pelaRegua, notaConc = '';
  if (concorrentes) {
    const c = concorrenteMaisBarato(anuncio.ficha, concorrentes, cfg);
    if (c - cfg.concAbaixo < revenda) { revenda = c - cfg.concAbaixo; notaConc = `, limitada pelo concorrente parecido a ${c}`; }
  }
  const lucroPrevisto = liquido(revenda) - preco;
  let margem = cfg.margemMin, notaLiq = '';
  if (cfg.liqMin > 0 && r.nLiq < cfg.liqMin) {
    if (cfg.liqMargemExtra == null) return { comprar: false, lucroPrevisto, ref: r.ref, revenda, nLiq: r.nLiq, motivo: `não compra: só ${r.nLiq} vendas da espécie na faixa de nível (mínimo ${cfg.liqMin})` };
    margem += cfg.liqMargemExtra; notaLiq = `; pouca liquidez (${r.nLiq} vendas): margem ${margem}`;
  }
  const exige = Math.max(cfg.lucroMin, margem * preco);
  let comprar = lucroPrevisto >= exige, notaDia = '', lucroDia = null;
  if (comprar && cfg.modeloRevenda && cfg.lucroDiaMin != null) {
    const { P, horasMedias } = chanceVenda(revenda / r.ref, cfg.modeloRevenda, cfg.horizonteH);
    const sobra = liquido(Math.floor(cfg.liquidacao * r.ref)) - preco;
    const esperado = P * lucroPrevisto + (1 - P) * sobra, dias = (horasMedias + (1 - P) * 24) / 24;
    lucroDia = esperado / preco / Math.max(dias, 1 / 24);
    if (lucroDia < cfg.lucroDiaMin) comprar = false;
    notaDia = `; vende em ${cfg.horizonteH} h com ${(P * 100).toFixed(0)}%, lucro esperado ${Math.round(esperado)} em ${dias.toFixed(1)} dias = ${(lucroDia * 100).toFixed(1)}%/dia (mínimo ${(cfg.lucroDiaMin * 100).toFixed(1)}%)`;
  }
  return { comprar, lucroPrevisto, ref: r.ref, revenda, nLiq: r.nLiq, lucroDia,
    motivo: `${comprar ? 'compra' : 'não compra'}: revenda ${revenda} (ref ${Math.round(r.ref)}, peso do preço ${w}, desconto ${cfg.desconto}${notaConc}), lucro ${lucroPrevisto} vs exigido ${Math.ceil(exige)}${notaLiq}${notaDia}; ${r.base}` };
}

// ---------- precoRevenda(compra, vendas, concorrentes, cfg) → { preco, piso, motivo } ----------
// compra = { preco (pago), ficha, em? }. concorrentes = anúncios abertos DE OUTROS { preco, nome, nivel|level, nota, potencia, aoe|tmAoe }.
// Anuncia na revenda esperada (a mesma conta do lucroPrevisto), concAbaixo Gema abaixo do concorrente parecido mais barato
// se ele estiver abaixo disso, e nunca abaixo do piso (empate com o que foi pago, já com taxa).
// Se não vender, baixar em degraus de 30 min (o jogo só deixa mudar a cada 30 min): `degraus`.
export function precoRevenda(compra, vendas, concorrentes = [], cfg = CFG_PADRAO) {
  cfg = { ...CFG_PADRAO, ...cfg };
  const f = compra.ficha;
  const agora = compra.em ?? Math.max(0, ...vendas.map((v) => v.em)) + 1;
  const r = referencia(f, vendas, agora, cfg);
  const piso = precoParaLiquido(compra.preco + 1);
  const maisBarato = concorrenteMaisBarato(f, concorrentes, cfg);
  const w = cfg.pesoPreco ?? 0;
  let alvo = r.ref ? Math.round(cfg.desconto * Math.exp((1 - w) * Math.log(r.ref) + w * Math.log(compra.preco))) : piso * 2;
  let motivo = r.ref ? `revenda esperada ${alvo} (${r.base})` : 'sem referência: 2× o piso';
  if (maisBarato - cfg.concAbaixo < alvo) { alvo = maisBarato - cfg.concAbaixo; motivo += `; ${cfg.concAbaixo} abaixo do concorrente parecido (${maisBarato})`; }
  const preco = Math.max(piso, alvo);
  if (preco === piso && alvo < piso) motivo += '; travado no piso';
  const degraus = [preco, Math.max(piso, Math.round(preco * 0.9)), Math.max(piso, Math.round(preco * 0.8)), piso];
  return { preco, piso, degraus: [...new Set(degraus)], motivo };
}
