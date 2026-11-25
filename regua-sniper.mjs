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

// ---------- referencia(ficha, vendas, agora) → { ref, n, base } ----------
// ref = preço bruto típico de venda de um shiny com esta ficha, só com vendas anteriores a `agora`.
// `cfg.beta` (opcional) evita recalcular as inclinações a cada chamada.
export function referencia(ficha, vendas, agora, cfg = CFG_PADRAO) {
  cfg = { ...CFG_PADRAO, ...cfg };
  const desde = agora - cfg.janelaDias * 86_400_000;
  const passadas = vendas.filter((v) => v.em < agora && v.em >= desde && v.ficha);
  const doTipo = passadas.filter((v) => mesmoTipo(v.ficha, ficha));
  const perto = doTipo.filter((v) => Math.abs(v.ficha.level - ficha.level) <= Math.max(20, ficha.level * 0.25));
  if (cfg.metodo === 'atual' || cfg.metodo === 'quantil') {
    const g = perto.filter((v) => Math.abs((v.ficha.nota ?? 0) - (ficha.nota ?? 0)) <= cfg.dNota).map((v) => v.bruto);
    if (g.length < cfg.minVizinhos) return { ref: null, n: g.length, base: 'poucas vendas parecidas' };
    return { ref: cfg.metodo === 'atual' ? mediana(g) : quantilDe(g, cfg.quantil), n: g.length, base: `${cfg.metodo} de ${g.length} vendas (nota ±${cfg.dNota})` };
  }
  if (doTipo.length < cfg.minVizinhos) return { ref: null, n: doTipo.length, base: 'poucas vendas da espécie' };
  const beta = cfg.beta ?? inclinacoes(passadas, cfg.feats);
  const x = vetor(ficha, cfg.feats);
  // preço de cada venda passada "trazido" para a ficha pedida: log p + beta·(x − x_venda)
  const ajust = (v) => Math.log(v.bruto) + vetor(v.ficha, cfg.feats).reduce((s, xv, j) => s + beta[j] * (x[j] - xv), 0);
  if (cfg.metodo === 'knn') {
    const esc = { nota: 0.3, lvl: 0.3, iv: 1, q: 0.15 };
    const d = (v) => cfg.feats.reduce((s, k) => s + Math.abs(FEAT[k](v.ficha) - FEAT[k](ficha)) / esc[k], 0);
    const viz = [...doTipo].sort((a, b) => d(a) - d(b)).slice(0, cfg.k);
    return { ref: Math.exp(mediana(viz.map(ajust))), n: viz.length, base: `knn ${viz.length} ajustados` };
  }
  // loglin: cada venda passada da espécie, ajustada para a ficha pedida; resume pela estatística escolhida
  let meu = doTipo.map(ajust);
  const dias = doTipo.map((v) => (agora - v.em) / 86_400_000);
  const pesos = cfg.meiaVidaDias ? dias.map((d) => 0.5 ** (d / cfg.meiaVidaDias)) : dias.map(() => 1);
  let tend = 0;
  if (cfg.tendencia && meu.length >= 3) { // log-preço ajustado contra o tempo, encolhido para zero
    const W = pesos.reduce((s, w) => s + w, 0), mt = dias.reduce((s, d, i) => s + pesos[i] * d, 0) / W, my = meu.reduce((s, y, i) => s + pesos[i] * y, 0) / W;
    let sxy = 0, sxx = 0; for (let i = 0; i < meu.length; i++) { sxy += pesos[i] * (dias[i] - mt) * (meu[i] - my); sxx += pesos[i] * (dias[i] - mt) ** 2; }
    tend = Math.max(-cfg.tendMax, Math.min(cfg.tendMax, -sxy / (sxx + cfg.lambdaTend))); // por dia, para frente no tempo
    meu = meu.map((y, i) => y + tend * dias[i]);
  }
  const mu = cfg.estat === 'media' ? meu.reduce((s, y, i) => s + pesos[i] * y, 0) / pesos.reduce((s, w) => s + w, 0) : (cfg.meiaVidaDias ? quantilPond : (v, _p, q) => quantilDe(v, q))(meu, pesos, cfg.estat === 'quantil' ? cfg.quantil : 0.5);
  return { ref: Math.exp(mu), n: meu.length, base: `loglin ${meu.length} vendas da espécie, β=${beta.map((b) => b.toFixed(2)).join('/')}${tend ? `, tendência ${(tend * 100).toFixed(1)}%/dia` : ''}` };
}

// ---------- deveComprar(anuncio, vendas, cfg) → { comprar, lucroPrevisto, motivo } ----------
// anuncio = { preco, ficha, em? }. lucroPrevisto = líquido(revenda) − preço, com
// revenda = desconto × ref^(1−w) × preço^w. O termo em preço corrige a "maldição do vencedor": um anúncio
// muito abaixo da referência costuma valer menos do que a referência diz (a ficha não captura tudo).
export function deveComprar(anuncio, vendas, cfg = CFG_PADRAO) {
  cfg = { ...CFG_PADRAO, ...cfg };
  const agora = anuncio.em ?? Math.max(0, ...vendas.map((v) => v.em)) + 1;
  const preco = anuncio.preco;
  if (!(preco > 0)) return { comprar: false, lucroPrevisto: 0, motivo: 'preço inválido' };
  if (preco > cfg.precoMax) return { comprar: false, lucroPrevisto: 0, motivo: `preço acima de ${cfg.precoMax}` };
  const r = referencia(anuncio.ficha, vendas, agora, cfg);
  if (r.ref == null) return { comprar: false, lucroPrevisto: 0, motivo: r.base, ref: null };
  const w = cfg.pesoPreco ?? 0;
  const revenda = Math.floor(cfg.desconto * Math.exp((1 - w) * Math.log(r.ref) + w * Math.log(preco)));
  const lucroPrevisto = liquido(revenda) - preco;
  const exige = Math.max(cfg.lucroMin, cfg.margemMin * preco);
  const comprar = lucroPrevisto >= exige;
  return { comprar, lucroPrevisto, ref: r.ref, revenda, motivo: `${comprar ? 'compra' : 'não compra'}: revenda ${revenda} (ref ${Math.round(r.ref)}, peso do preço ${w}, desconto ${cfg.desconto}), lucro ${lucroPrevisto} vs exigido ${Math.ceil(exige)}; ${r.base}` };
}

// ---------- precoRevenda(compra, vendas, concorrentes, cfg) → { preco, piso, motivo } ----------
// compra = { preco (pago), ficha, em? }. concorrentes = anúncios abertos { preco, nome, nivel|level, nota, potencia, aoe|tmAoe }.
// Anuncia na revenda esperada (a mesma conta do lucroPrevisto), 1 Gema abaixo do concorrente parecido mais barato
// se ele estiver abaixo disso, e nunca abaixo do piso (empate com o que foi pago, já com taxa).
// Se não vender, baixar em degraus de 30 min (o jogo só deixa mudar a cada 30 min): `degraus`.
export function precoRevenda(compra, vendas, concorrentes = [], cfg = CFG_PADRAO) {
  cfg = { ...CFG_PADRAO, ...cfg };
  const f = compra.ficha;
  const agora = compra.em ?? Math.max(0, ...vendas.map((v) => v.em)) + 1;
  const r = referencia(f, vendas, agora, cfg);
  const piso = precoParaLiquido(compra.preco + 1);
  const parecidos = concorrentes.filter((c) => c.nome === f.nome && (c.potencia ?? 1) === pot(f) && !!(c.aoe ?? c.tmAoe) === !!f.tmAoe
    && Math.abs((c.nivel ?? c.level) - f.level) <= Math.max(20, f.level * 0.25) && (c.nota ?? 0) >= (f.nota ?? 0) - 0.1);
  const maisBarato = parecidos.length ? Math.min(...parecidos.map((c) => c.preco)) : Infinity;
  const w = cfg.pesoPreco ?? 0;
  let alvo = r.ref ? Math.round(cfg.desconto * Math.exp((1 - w) * Math.log(r.ref) + w * Math.log(compra.preco))) : piso * 2;
  let motivo = r.ref ? `revenda esperada ${alvo} (${r.base})` : 'sem referência: 2× o piso';
  if (maisBarato - 1 < alvo) { alvo = maisBarato - 1; motivo += `; 1 abaixo do concorrente parecido (${maisBarato})`; }
  const preco = Math.max(piso, alvo);
  if (preco === piso && alvo < piso) motivo += '; travado no piso';
  const degraus = [preco, Math.max(piso, Math.round(preco * 0.9)), Math.max(piso, Math.round(preco * 0.8)), piso];
  return { preco, piso, degraus: [...new Set(degraus)], motivo };
}
