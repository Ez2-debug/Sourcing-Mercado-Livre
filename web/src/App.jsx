import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BookOpenText, Bot, CheckCircle2, CircleAlert, ClipboardList, Download, FileSpreadsheet,
  Factory, LayoutDashboard, Minus, Package, Pause, Pickaxe, Play, Plug, ShoppingBag, Store, TrendingUp,
} from 'lucide-react';
import {
  COTACAO_URL, carregarCotacoesCompletas, carregarEmAlta, carregarIntegracoes, carregarPacote, carregarPacotes, carregarPedidos, carregarProdutos,
  carregarShopee, carregarVisaoGeral, comSupabase, comandarMinerador, criarPedido, gerarPlanilhas, supabase,
} from './fonte.js';
import { Aviso, Botao, Card, CardTitulo, Carregando, Indicador, Selo, Tabela } from './ui.jsx';
import { TIPOS_DE_RAZAO, faixaDePreco, montarRazao } from './razao.js';
import { baixarPlanilha } from './planilha.js';

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const reais = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
const inteiro = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '');
const dia = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function hora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? h : `${dia(iso)} ${h}`;
}

// Fotos e links vem de fora: so entram na pagina os enderecos esperados.
const CDNS = /^https:\/\/[a-z0-9.-]+\.(mlstatic\.com|susercontent\.com|alicdn\.com)\//i;
const fotoSegura = (u) => (typeof u === 'string' && CDNS.test(u) ? u : null);
const linkSeguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

// Carrega ao abrir e a cada `intervalo` ms; `recarregar` busca de novo na hora.
function useDados(carregar, intervalo) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  const [volta, setVolta] = useState(0);
  useEffect(() => {
    let vivo = true;
    const buscar = () => carregar().then(
      (dados) => vivo && setEstado({ dados, erro: null, carregando: false }),
      (err) => vivo && setEstado((e) => ({ dados: e.dados, erro: err.message, carregando: false })),
    );
    buscar();
    const t = intervalo ? setInterval(buscar, intervalo) : null;
    return () => { vivo = false; clearInterval(t); };
  }, [carregar, intervalo, volta]);
  return { ...estado, recarregar: () => setVolta((v) => v + 1) };
}

function Foto({ src, grande }) {
  const ok = fotoSegura(src);
  const classe = grande ? 'h-36 w-full' : 'size-12';
  return ok
    ? <img className={`${classe} shrink-0 rounded-md border bg-white object-contain`} src={ok} alt="" loading="lazy" />
    : <div className={`${classe} grid shrink-0 place-items-center rounded-md border bg-muted text-[10px] text-muted-foreground`}>sem foto</div>;
}

function Nome({ nome, link }) {
  const href = linkSeguro(link);
  return href
    ? <a className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline" href={href} target="_blank" rel="noopener noreferrer">{nome}</a>
    : <span className="font-medium">{nome}</span>;
}

function Estado({ erro, carregando, dados }) {
  if (carregando && !dados) return <Carregando />;
  if (erro && !dados) return <Aviso>{erro}</Aviso>;
  return erro ? <Aviso>{erro}</Aviso> : null;
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function Marca({ sub }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">C</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight">Conecta Hub Sourcing</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </div>
  );
}

// O Supabase devolve motivos diferentes para a recusa; cada um pede uma acao diferente.
function motivoDoLogin(error) {
  const m = String(error.message || '');
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha não conferem. O acesso é criado pelo administrador; não é a senha do GitHub nem a do Supabase.';
  if (/email not confirmed/i.test(m)) return 'Este e-mail ainda não foi confirmado. Peça ao administrador para confirmar o usuário.';
  if (/api key|apikey|jwt/i.test(m)) return 'O site está com a chave pública do Supabase errada. Avise o administrador.';
  if (/failed to fetch|network/i.test(m)) return 'Não consegui falar com o servidor. Confira a conexão e tente de novo.';
  return `Não foi possível entrar: ${m || 'erro desconhecido'}.`;
}

function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(ev) {
    ev.preventDefault();
    setEnviando(true);
    setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) setErro(motivoDoLogin(error));
    setEnviando(false);
  }

  const campo = 'h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40';
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form className="grid w-full max-w-sm gap-4 rounded-lg border bg-card p-6 shadow-xs" onSubmit={entrar}>
        <Marca sub="Produtos em alta para importar" />
        <label className="grid gap-1 text-sm text-muted-foreground">E-mail
          <input className={campo} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-muted-foreground">Senha
          <input className={campo} type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <Aviso>{erro}</Aviso>}
        <Botao variante="primario" disabled={enviando}>{enviando ? 'Entrando' : 'Entrar'}</Botao>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */

function duracao(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const dois = (n) => String(n).padStart(2, '0');
  return `${dois(Math.floor(s / 60))}:${dois(s % 60)}`;
}

function Minerador({ d, recarregar }) {
  const [, tic] = useState(0);
  useEffect(() => { const t = setInterval(() => tic((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const minerando = d.situacao === 'minerando';
  const pausado = d.situacao === 'pausado';
  const mandar = (nome) => comandarMinerador(nome).then(recarregar, recarregar);
  let rotulo = 'Próxima mineração em';
  let relogio = d.proxima_em ? duracao(new Date(d.proxima_em).getTime() - Date.now()) : '--:--';
  if (minerando && d.atual) { rotulo = 'Minerando há'; relogio = duracao(Date.now() - new Date(d.atual.iniciado_em).getTime()); }
  if (pausado) { rotulo = 'Mineração pausada'; relogio = '--:--'; }
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={`size-2 rounded-full ${pausado ? 'bg-warning' : 'bg-success'} ${minerando ? 'pulsa' : ''}`} />
            {minerando ? 'Minerando agora no Mercado Livre' : pausado ? 'Minerador pausado' : 'Minerador ativo'}
          </div>
          <div className="mt-1 text-xl font-semibold tracking-tight break-words">{minerando && d.atual ? d.atual.caminho : 'Aguardando a próxima categoria da fila'}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">{rotulo}</div>
          <div className="text-3xl font-semibold tabular-nums">{relogio}</div>
        </div>
        <div className="flex gap-2">
          <Botao onClick={() => mandar(pausado ? 'retomar' : 'pausar')}>{pausado ? <Play className="size-4" /> : <Pause className="size-4" />}{pausado ? 'Retomar' : 'Pausar'}</Botao>
          <Botao variante="primario" disabled={minerando} onClick={() => mandar('minerar-agora')}><Pickaxe className="size-4" />Minerar agora</Botao>
        </div>
      </div>
      <div className={`mt-4 h-1.5 rounded-full bg-accent ${minerando ? 'ao-vivo' : ''}`} />
    </Card>
  );
}

function Painel() {
  const { dados: d, erro, carregando, recarregar } = useDados(carregarVisaoGeral, 5000);
  if (!d) return <Estado erro={erro} carregando={carregando} dados={d} />;
  return (
    <>
      {erro && <Aviso>{erro}</Aviso>}
      {d.demonstracao && <Minerador d={d} recarregar={recarregar} />}
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Indicador rotulo="Categorias mineradas hoje" valor={d.hoje.categorias} nota={d.ultima_mineracao ? `última às ${hora(d.ultima_mineracao)}` : 'nenhuma ainda'} icone={Activity} />
        <Indicador rotulo="Produtos lidos hoje" valor={d.hoje.produtos} nota="com detalhe de catálogo" icone={Package} />
        <Indicador rotulo="Aptos para cotação" valor={d.hoje.aptos} nota="sem marca conhecida nem alerta" icone={CheckCircle2} />
        <Indicador rotulo="Categorias acompanhadas" valor={d.categorias_acompanhadas} nota="mineradas em rodízio" icone={ClipboardList} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitulo titulo="Sugestões de hoje" descricao="Aptos com maior prioridade de triagem. Prioridade é regra de triagem, não medida de demanda." />
          <div className="grid gap-3">
            {!d.hoje.sugestoes.length && <p className="text-sm text-muted-foreground">Ainda não há produto apto minerado hoje.</p>}
            {d.hoje.sugestoes.map((s) => (
              <div className="flex items-center gap-3" key={s.id || s.link || s.nome}>
                <Foto src={s.foto} />
                <div className="min-w-0 text-sm">
                  <div className="break-words"><Nome nome={s.nome} link={s.link} /></div>
                  <p className="text-xs text-muted-foreground">{[s.categoria, reais(s.menor_preco), `prioridade ${s.prioridade}`, s.ncm ? `NCM sugerida ${s.ncm}` : ''].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitulo titulo="Últimas minerações" descricao="Cada categoria é lida de novo a cada ciclo; é isso que forma o histórico de ranking." />
          <Tabela colunas={[{ titulo: 'Horário' }, { titulo: 'Categoria' }, { titulo: 'Produtos', num: true }, { titulo: 'Aptos', num: true }]} vazio={!d.historico.length && 'Nenhuma mineração ainda.'}>
            {d.historico.map((h) => (
              <tr key={h.id}><td className="whitespace-nowrap">{hora(h.quando)}</td><td>{h.categoria}</td><td className="text-right tabular-nums">{h.produtos}</td><td className="text-right tabular-nums">{h.aptos}</td></tr>
            ))}
          </Tabela>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Em alta                                                             */
/* ------------------------------------------------------------------ */

const textoDoPedido = (p) => `Quero cotar a importação deste produto: ${p.nome} (${p.id})${p.link ? ` ${p.link}` : ''}`;

function Cotar({ produto }) {
  const [copiado, setCopiado] = useState(false);
  if (COTACAO_URL) {
    return <a className="mt-auto inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-110" href={COTACAO_URL.replace('{pedido}', encodeURIComponent(textoDoPedido(produto)))} target="_blank" rel="noopener noreferrer">Cotar importação</a>;
  }
  const copiar = () => navigator.clipboard.writeText(textoDoPedido(produto)).then(() => {
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  });
  return <Botao pequeno className="mt-auto" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar pedido de cotação'}</Botao>;
}

function CartaoDeProduto({ p }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs">
      <Foto src={p.foto} grande />
      {p.subiu
        ? <Selo tom="ok" className="self-start"><ArrowUpRight className="size-3" />{p.subiu} · {p.posicao_anterior}º → {p.posicao}º</Selo>
        : <Selo tom="primario" className="self-start">Entrou em {p.posicao}º</Selo>}
      <div className="text-sm break-words"><Nome nome={p.nome} link={p.link} /></div>
      {typeof p.menor_preco === 'number' && <div className="text-lg font-semibold tabular-nums">{reais(p.menor_preco)}</div>}
      <p className="text-xs text-muted-foreground">{[p.categoria, p.ncm ? `NCM sugerida ${p.ncm}` : '', `comparado com ${dia(p.comparado_com)}`].filter(Boolean).join(' · ')}</p>
      <Cotar produto={p} />
    </article>
  );
}

function resumoDaAlta(a) {
  if (!a.categorias_comparadas) return 'Ainda não há duas minerações da mesma categoria para comparar. O histórico começa a aparecer no segundo ciclo.';
  let t = `${a.categorias_comparadas} categorias comparadas · ${a.total_subindo} produtos aptos subiram · ${a.total_entraram} entraram.`;
  if (a.menor_periodo_em_dias !== null && a.menor_periodo_em_dias < a.dias_pedidos) {
    t += ` O histórico ainda é mais curto que ${a.dias_pedidos} dias: há categoria comparada com ${a.menor_periodo_em_dias.toLocaleString('pt-BR')} dia(s) atrás. A data de comparação aparece em cada produto.`;
  }
  if (a.categorias_sem_historico) t += ` ${a.categorias_sem_historico} categorias ainda têm uma mineração só.`;
  return t;
}

function Alternador({ opcoes, valor, aoMudar }) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border">
      {opcoes.map(([v, rotulo]) => (
        <button key={String(v)} aria-pressed={valor === v} onClick={() => aoMudar(v)} className={`h-8 px-3 text-xs font-medium ${valor === v ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>{rotulo}</button>
      ))}
    </span>
  );
}

function EmAlta() {
  const [dias, setDias] = useState(7);
  const carregar = useCallback(() => carregarEmAlta(dias), [dias]);
  const { dados: a, erro, carregando } = useDados(carregar, 0);
  const grade = 'grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3';
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted-foreground">{a ? resumoDaAlta(a) : ''}</p>
        <Alternador opcoes={[[7, '7 dias'], [30, '30 dias']]} valor={dias} aoMudar={setDias} />
      </div>
      <Estado erro={erro} carregando={carregando} dados={a} />
      {a && (
        <>
          <h2 className="mb-2 text-base font-semibold">Subindo no ranking</h2>
          <div className={`${grade} mb-6`}>
            {!a.subindo.length && <p className="text-sm text-muted-foreground">Nenhum produto apto subiu no período.</p>}
            {a.subindo.map((p) => <CartaoDeProduto key={p.id} p={p} />)}
          </div>
          <h2 className="mb-2 text-base font-semibold">Entraram entre os mais bem colocados</h2>
          <div className={grade}>
            {!a.entraram.length && <p className="text-sm text-muted-foreground">Nenhum produto apto entrou no período.</p>}
            {a.entraram.map((p) => <CartaoDeProduto key={p.id} p={p} />)}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Mercado Livre                                                       */
/* ------------------------------------------------------------------ */

const SITUACOES = {
  apto: ['ok', 'Apto para cotação'],
  marca_registrada: ['alerta', 'Marca conhecida'],
  regulado: ['alerta', 'Alerta regulatório'],
  proibido: ['erro', 'Proibido'],
};

function MercadoLivre() {
  const [soAptos, setSoAptos] = useState(true);
  const { dados: d, erro, carregando } = useDados(carregarProdutos, 60000);
  const itens = d ? d.itens.filter((p) => !soAptos || p.situacao === 'apto') : [];
  return (
    <Card>
      <CardTitulo
        titulo="Produtos minerados hoje"
        descricao="Ranking de mais vendidos por categoria, pela API oficial. A API informa posição, não quantidade; vendas e avaliações são estimativas do JoomPulse quando registradas."
        acao={<Alternador opcoes={[[true, 'Só aptos'], [false, 'Todos']]} valor={soAptos} aoMudar={setSoAptos} />}
      />
      <Estado erro={erro} carregando={carregando} dados={d} />
      {d && (
        <Tabela
          colunas={[{ titulo: 'Produto' }, { titulo: 'Posição', num: true }, { titulo: 'Menor preço', num: true }, { titulo: 'Triagem' }, { titulo: 'NCM sugerida' }, { titulo: 'Vendas est.', num: true }, { titulo: 'Avaliações', num: true }]}
          vazio={!itens.length && 'Nenhum produto minerado hoje com esse filtro.'}
        >
          {itens.map((p) => (
            <tr key={`${p.mineracao_id}-${p.id}`}>
              <td className="min-w-64"><div className="flex items-center gap-3"><Foto src={p.foto} /><div className="min-w-0"><div className="break-words"><Nome nome={p.nome} link={p.link} /></div><div className="text-xs text-muted-foreground">{p.categoria}</div></div></div></td>
              <td className="text-right tabular-nums">{p.posicao}º</td>
              <td className="text-right whitespace-nowrap tabular-nums">{reais(p.menor_preco)}</td>
              <td><Selo tom={(SITUACOES[p.situacao] || ['neutro'])[0]}>{(SITUACOES[p.situacao] || [null, p.situacao])[1]}</Selo></td>
              <td className="whitespace-nowrap">{p.ncm || ''}</td>
              <td className="text-right tabular-nums" title={p.fonte_da_estimativa || ''}>{inteiro(p.vendas_estimadas)}</td>
              <td className="text-right tabular-nums">{inteiro(p.avaliacoes)}{p.nota ? <span className="text-muted-foreground"> · {p.nota}</span> : null}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Shopee                                                              */
/* ------------------------------------------------------------------ */

function Tendencia({ valor }) {
  if (valor === 'subindo') return <Selo tom="ok"><ArrowUpRight className="size-3" />Subindo</Selo>;
  if (valor === 'caindo') return <Selo tom="erro"><ArrowDownRight className="size-3" />Caindo</Selo>;
  if (valor === 'estavel') return <Selo><Minus className="size-3" />Estável</Selo>;
  return null;
}

function PedirAoClaude({ pedido, rotulo }) {
  const [estado, setEstado] = useState(null);
  // Na versao hospedada nao ha backend local para receber o pedido.
  if (comSupabase) return null;
  const pedir = () => criarPedido(pedido).then(() => setEstado('ok'), (e) => setEstado(e.message));
  if (estado === 'ok') return <Selo tom="primario"><Bot className="size-3" />Pedido na fila do Claude</Selo>;
  return <Botao pequeno onClick={pedir} title={estado || ''}><Bot className="size-4" />{rotulo}</Botao>;
}

function Shopee() {
  const [semMarca, setSemMarca] = useState(true);
  const { dados: d, erro, carregando } = useDados(carregarShopee, 60000);
  const itens = d ? d.itens.filter((p) => !semMarca || !p.tem_marca) : [];
  return (
    <Card>
      <CardTitulo
        titulo="Mais vendidos na Shopee Brasil"
        descricao={d && d.consultado_em
          ? `Leitura de ${hora(d.consultado_em)}, pelo JoomPulse. Vendas e faturamento são estimativas do JoomPulse a partir do contador público arredondado da Shopee; não são vendas reais.`
          : (comSupabase
            ? 'Ainda não há leitura da Shopee publicada. Ela aparece aqui quando o minerador enviar os dados.'
            : 'Ainda sem leitura. Os dados vêm do JoomPulse, que só o Claude alcança: peça a atualização.')}
        acao={<div className="flex flex-wrap items-center gap-2"><Alternador opcoes={[[true, 'Sem marca'], [false, 'Todos']]} valor={semMarca} aoMudar={setSemMarca} /><PedirAoClaude pedido={{ tipo: 'shopee' }} rotulo="Pedir atualização" /></div>}
      />
      <Estado erro={erro} carregando={carregando} dados={d} />
      {d && (
        <Tabela
          colunas={[{ titulo: 'Produto' }, { titulo: 'Preço', num: true }, { titulo: 'Vendas est. 30 dias', num: true }, { titulo: 'Faturamento est.', num: true }, { titulo: 'Tendência' }, { titulo: 'Avaliações', num: true }, { titulo: 'Loja' }]}
          vazio={!itens.length && 'Nenhum produto nesta leitura.'}
        >
          {itens.map((p) => (
            <tr key={p.id}>
              <td className="min-w-64"><div className="flex items-center gap-3"><Foto src={p.foto} /><div className="min-w-0"><div className="break-words"><Nome nome={p.nome} link={p.link} /></div><div className="text-xs text-muted-foreground">{[p.categoria, p.marca].filter(Boolean).join(' · ')}</div></div></div></td>
              <td className="text-right whitespace-nowrap tabular-nums">{reais(p.preco)}</td>
              <td className="text-right tabular-nums">{inteiro(p.vendas_30_dias)}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{reais(p.faturamento_30_dias)}</td>
              <td><Tendencia valor={p.tendencia} /></td>
              <td className="text-right tabular-nums">{inteiro(p.avaliacoes)}{p.nota ? <span className="text-muted-foreground"> · {p.nota}</span> : null}</td>
              <td className="text-xs text-muted-foreground">{p.local_da_loja}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Cotacoes (Accio + Alibaba)                                          */
/* ------------------------------------------------------------------ */

function Lado({ rotulo, foto, nome, link, linhas }) {
  return (
    <div className="flex min-w-0 gap-3">
      <Foto src={foto} />
      <div className="min-w-0 text-sm">
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{rotulo}</div>
        <div className="break-words"><Nome nome={nome} link={link} /></div>
        {linhas.filter(Boolean).map((t) => <p key={t} className="text-xs break-words text-muted-foreground">{t}</p>)}
      </div>
    </div>
  );
}

function Cotacao({ pacote }) {
  const carregar = useCallback(() => carregarPacote(pacote.id), [pacote.id]);
  const { dados: d, erro, carregando } = useDados(carregar, 0);
  return (
    <Card className="mt-4">
      <CardTitulo titulo={`Cotação · ${pacote.categoria}`} descricao="Preço do Alibaba é o do anúncio, em dólares: não é cotação FOB e não inclui frete nem impostos." />
      <Estado erro={erro} carregando={carregando} dados={d} />
      {d && d.erro && <Aviso>{d.erro}</Aviso>}
      {d && d.linhas && (
        <div className="grid gap-2">
          {d.linhas.map((x) => {
            const c = x.candidato;
            return (
              <div key={x.produto.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
                <Lado rotulo="Mercado Livre" foto={x.produto.foto} nome={x.produto.nome} link={x.produto.link} linhas={[reais(x.produto.menor_preco), x.produto.id]} />
                {c
                  ? <Lado rotulo="Alibaba" foto={c.foto} nome={c.titulo} link={c.link} linhas={[c.fornecedor, [c.preco, c.moq ? `MOQ ${c.moq}` : '', c.local].filter(Boolean).join(' · '), `${c.aderencia ? `Aderência ${c.aderencia} · ` : ''}${x.cruzamento === 'codigo' ? 'cruzado pelo código' : 'cruzado por semelhança; conferir'}`]} />
                  : <Lado rotulo="Alibaba" nome="Sem candidato" linhas={[]} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Cotacoes() {
  const { dados: d, erro, carregando } = useDados(carregarPacotes, 30000);
  const [aberto, setAberto] = useState(null);
  const [aviso, setAviso] = useState('');
  const planilhas = (p) => {
    setAviso('Gerando as planilhas.');
    gerarPlanilhas(p.id).then((r) => setAviso(`Planilhas gravadas: ${r.mercado_livre} e ${r.alibaba}`), (e) => setAviso(e.message));
  };
  return (
    <>
      <Card>
        <CardTitulo titulo="Pacotes e cotações" descricao="Cada mineração do Mercado Livre gera um pacote com os produtos aptos. O Accio Work cota esses produtos no Alibaba; o pedido é levado ao Accio pelo Claude." />
        <Estado erro={erro} carregando={carregando} dados={d} />
        {d && (
          <Tabela colunas={[{ titulo: 'Minerado em' }, { titulo: 'Categoria' }, { titulo: 'Produtos', num: true }, { titulo: 'Cotação no Alibaba' }, { titulo: 'Ações' }]} vazio={!d.pacotes.length && (comSupabase ? 'Nenhuma cotação publicada ainda. Elas aparecem aqui quando o minerador enviar os dados.' : 'Nenhum pacote gravado ainda.')}>
            {d.pacotes.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{hora(p.minerado_em)}</td>
                <td>{p.categoria}</td>
                <td className="text-right tabular-nums">{p.produtos}</td>
                <td>{p.sourcing ? <Selo tom="ok"><CheckCircle2 className="size-3" />{p.sourcing.candidatos} candidatos</Selo> : <Selo tom="alerta">Aguardando</Selo>}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {p.sourcing
                      ? <><Botao pequeno onClick={() => setAberto(p)}>Ver cotação</Botao>{!comSupabase && <Botao pequeno onClick={() => planilhas(p)}><FileSpreadsheet className="size-4" />Gerar planilhas</Botao>}</>
                      : <PedirAoClaude pedido={{ tipo: 'cotacao', alvo: p.id }} rotulo="Pedir cotação" />}
                  </div>
                </td>
              </tr>
            ))}
          </Tabela>
        )}
        {aviso && <p className="mt-3 text-xs break-words text-muted-foreground">{aviso}</p>}
      </Card>
      {aberto && <Cotacao key={aberto.id} pacote={aberto} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Alibaba                                                             */
/* ------------------------------------------------------------------ */

const dolares = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' }) : '');

function Alibaba() {
  const { dados: cotacoes, erro, carregando } = useDados(carregarCotacoesCompletas, 60000);
  const linhas = (cotacoes || []).flatMap((c) => c.linhas.filter((l) => l.candidato).map((l) => ({ ...l, categoria: c.categoria })));
  return (
    <Card>
      <CardTitulo
        titulo="Fornecedores cotados no Alibaba"
        descricao="Um candidato por produto do Mercado Livre, levantado pelo Accio Work. Preço e MOQ são os do anúncio, em dólares: não é cotação FOB e não inclui frete nem impostos."
      />
      <Estado erro={erro} carregando={carregando} dados={cotacoes} />
      {cotacoes && (
        <Tabela
          colunas={[{ titulo: 'Anúncio no Alibaba' }, { titulo: 'Fornecedor' }, { titulo: 'Preço mín.', num: true }, { titulo: 'Preço máx.', num: true }, { titulo: 'MOQ' }, { titulo: 'Aderência', num: true }, { titulo: 'Produto no Mercado Livre' }]}
          vazio={!linhas.length && (comSupabase ? 'Nenhuma cotação publicada ainda. Elas aparecem aqui quando o minerador enviar os dados.' : 'Nenhum produto cotado ainda. Peça uma cotação na tela Cotações.')}
        >
          {linhas.map((l) => {
            const c = l.candidato;
            const faixa = faixaDePreco(c.preco);
            return (
              <tr key={`${l.produto.id}-${c.link || c.titulo}`}>
                <td className="min-w-64"><div className="flex items-center gap-3"><Foto src={c.foto} /><div className="min-w-0"><div className="break-words"><Nome nome={c.titulo} link={c.link} /></div><div className="text-xs text-muted-foreground">{c.local}</div></div></div></td>
                <td className="text-sm break-words">{c.fornecedor}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{dolares(faixa.min)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{dolares(faixa.max)}</td>
                <td className="whitespace-nowrap">{c.moq}</td>
                <td className="text-right tabular-nums">{c.aderencia}</td>
                <td className="min-w-56 text-sm">
                  <div className="break-words"><Nome nome={l.produto.nome} link={l.produto.link} /></div>
                  <div className="text-xs text-muted-foreground">{[reais(l.produto.menor_preco), l.produto.id, l.cruzamento === 'codigo' ? '' : 'cruzado por semelhança; conferir'].filter(Boolean).join(' · ')}</div>
                </td>
              </tr>
            );
          })}
        </Tabela>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Razao                                                               */
/* ------------------------------------------------------------------ */

// Junta as tres fontes; uma que falhe nao impede as outras de sair na planilha.
async function carregarTudoParaORazao() {
  const [produtos, shopee, cotacoes] = await Promise.allSettled([carregarProdutos(), carregarShopee(), carregarCotacoesCompletas()]);
  const falhas = [];
  if (produtos.status === 'rejected') falhas.push('Mercado Livre');
  if (shopee.status === 'rejected') falhas.push('Shopee');
  if (cotacoes.status === 'rejected') falhas.push('cotações do Alibaba');
  return {
    produtos: produtos.status === 'fulfilled' ? produtos.value.itens : [],
    shopee: shopee.status === 'fulfilled' ? shopee.value.itens : [],
    cotacoes: cotacoes.status === 'fulfilled' ? cotacoes.value : [],
    falhas,
  };
}

function Razao() {
  const { dados: d, erro, carregando } = useDados(carregarTudoParaORazao, 0);
  const [tipo, setTipo] = useState('composto');
  const [situacao, setSituacao] = useState(null);
  const linhasDeCotacao = d ? d.cotacoes.reduce((t, c) => t + c.linhas.length, 0) : 0;
  const quantas = d ? { composto: linhasDeCotacao, 'mercado-livre': d.produtos.length, shopee: d.shopee.length, alibaba: linhasDeCotacao } : {};

  const baixar = async () => {
    setSituacao('Gerando a planilha.');
    try {
      const razao = montarRazao(tipo, d);
      await baixarPlanilha(razao);
      setSituacao(`Planilha gerada: ${razao.arquivo} (${razao.linhas} linhas na primeira aba).`);
    } catch (e) {
      setSituacao(`Não consegui gerar a planilha: ${e.message}`);
    }
  };

  return (
    <Card>
      <CardTitulo titulo="Tirar o razão em Excel" descricao="A planilha sai com os dados que o site tem agora, nos moldes das planilhas de cotação. Escolha o formato e baixe." />
      <Estado erro={erro} carregando={carregando} dados={d} />
      {d && d.falhas.length > 0 && <Aviso>Não consegui ler: {d.falhas.join(', ')}. O razão sai sem essa parte.</Aviso>}
      {d && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3" role="radiogroup" aria-label="Formato do razão">
            {TIPOS_DE_RAZAO.map(([id, rotulo, descricao]) => (
              <button key={id} role="radio" aria-checked={tipo === id} onClick={() => setTipo(id)}
                className={`rounded-lg border p-4 text-left transition ${tipo === id ? 'border-primary bg-accent' : 'bg-card hover:bg-muted'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{rotulo}</span>
                  <Selo tom={quantas[id] ? 'primario' : 'neutro'} className="ml-auto">{quantas[id]} linhas</Selo>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{descricao}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Botao variante="primario" onClick={baixar} disabled={!quantas[tipo]}><Download className="size-4" />Baixar planilha (.xlsx)</Botao>
            {!quantas[tipo] && <span className="text-sm text-muted-foreground">Ainda não há dados para este formato.</span>}
            {situacao && <span className="text-sm break-words text-muted-foreground">{situacao}</span>}
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>O composto traz uma linha por produto do Mercado Livre que já foi cotado no Alibaba; a Shopee entra por semelhança de nome, para conferir.</li>
            <li>Preço do Alibaba é o do anúncio, em dólares, sem conversão: não é cotação FOB.</li>
            <li>A planilha baixada pelo site não embute fotos; ela traz o link de cada foto.</li>
          </ul>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pedidos ao Claude                                                   */
/* ------------------------------------------------------------------ */

const SITUACAO_DO_PEDIDO = { pendente: ['alerta', 'Pendente'], concluido: ['ok', 'Concluído'], falhou: ['erro', 'Falhou'] };

function Pedidos() {
  const { dados: d, erro, carregando, recarregar } = useDados(carregarPedidos, 10000);
  const [texto, setTexto] = useState('');
  const [falha, setFalha] = useState(null);
  const enviar = (ev) => {
    ev.preventDefault();
    criarPedido({ tipo: 'livre', texto }).then(() => { setTexto(''); setFalha(null); recarregar(); }, (e) => setFalha(e.message));
  };
  return (
    <Card>
      <CardTitulo titulo="Pedidos ao Claude" descricao="O que só o Claude alcança (JoomPulse e o Accio) entra nesta fila. O Claude executa os pendentes quando você abre o Claude Code e pede para atender a fila." />
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={enviar}>
        <input className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40" placeholder="Ex.: cote no Alibaba 5 fornecedores de garrafa térmica 1 litro sem marca" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} required />
        <Botao variante="primario"><Bot className="size-4" />Enviar pedido</Botao>
      </form>
      {falha && <Aviso>{falha}</Aviso>}
      <Estado erro={erro} carregando={carregando} dados={d} />
      {d && (
        <Tabela colunas={[{ titulo: 'Criado' }, { titulo: 'Pedido' }, { titulo: 'Situação' }, { titulo: 'Resultado' }]} vazio={!d.pedidos.length && 'Nenhum pedido ainda.'}>
          {d.pedidos.map((p) => (
            <tr key={p.id}>
              <td className="whitespace-nowrap">{hora(p.criado_em)}</td>
              <td><div className="font-medium">{d.tipos[p.tipo] || p.tipo}</div><div className="text-xs break-words text-muted-foreground">{[p.alvo, p.texto].filter(Boolean).join(' · ')}</div></td>
              <td><Selo tom={SITUACAO_DO_PEDIDO[p.situacao][0]}>{SITUACAO_DO_PEDIDO[p.situacao][1]}</Selo></td>
              <td className="text-xs break-words text-muted-foreground">{p.resultado || ''}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Integracoes                                                         */
/* ------------------------------------------------------------------ */

function Integracoes() {
  const { dados: lista, erro, carregando } = useDados(carregarIntegracoes, 15000);
  return (
    <>
      <Estado erro={erro} carregando={carregando} dados={lista} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {(lista || []).map((i) => (
          <Card key={i.id}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="mr-auto text-base font-semibold">{i.nome}</h2>
              {i.ok ? <Selo tom="ok"><CheckCircle2 className="size-3" />Ligada</Selo> : <Selo tom="alerta"><CircleAlert className="size-3" />Pendente</Selo>}
            </div>
            <p className="text-xs text-muted-foreground">{i.via}</p>
            <p className="mt-2 text-sm break-words">{i.detalhe}</p>
            {i.atualizado_em && <p className="mt-2 text-xs text-muted-foreground">Última atividade: {hora(i.atualizado_em)}</p>}
          </Card>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Aplicativo                                                          */
/* ------------------------------------------------------------------ */

const TODAS_AS_TELAS = [
  ['painel', 'Painel', LayoutDashboard, Painel, 'Mineração ao vivo e resumo do dia'],
  ['alta', 'Em alta', TrendingUp, EmAlta, 'Produtos aptos que subiram no ranking do Mercado Livre'],
  ['ml', 'Mercado Livre', Store, MercadoLivre, 'Produtos minerados pela API oficial'],
  ['shopee', 'Shopee', ShoppingBag, Shopee, 'Mais vendidos da Shopee Brasil, pelo JoomPulse'],
  ['alibaba', 'Alibaba', Factory, Alibaba, 'Fornecedores cotados para os produtos do Mercado Livre'],
  ['cotacoes', 'Cotações', FileSpreadsheet, Cotacoes, 'Pacotes enviados ao Accio Work e comparação lado a lado'],
  ['razao', 'Razão', BookOpenText, Razao, 'Planilha composta ou de um marketplace por vez'],
  ['pedidos', 'Pedidos ao Claude', Bot, Pedidos, 'Fila do que só o Claude executa'],
  ['integracoes', 'Integrações', Plug, Integracoes, 'Situação de cada ligação'],
];
// Pedidos e Integracoes falam com o backend deste computador; na versao hospedada ficam de fora.
const TELAS = TODAS_AS_TELAS.filter(([id]) => !comSupabase || !['pedidos', 'integracoes'].includes(id));

export default function App() {
  const [sessao, setSessao] = useState(undefined);
  const [tela, setTela] = useState('painel');

  useEffect(() => {
    if (!comSupabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (comSupabase && sessao === undefined) return null;
  if (comSupabase && !sessao) return <Login />;

  const [, titulo, , Tela, subtitulo] = TELAS.find(([id]) => id === tela);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b bg-sidebar p-3 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="px-2 py-2"><Marca sub="Sourcing para importação" /></div>
        <nav className="mt-2 flex gap-1 overflow-x-auto md:mt-4 md:flex-col md:overflow-visible" aria-label="Seções">
          {TELAS.map(([id, rotulo, Icone]) => (
            <button key={id} onClick={() => setTela(id)} aria-current={tela === id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition ${tela === id ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <Icone className="size-4" aria-hidden="true" />{rotulo}
            </button>
          ))}
        </nav>
        <div className="mt-4 hidden px-3 text-xs text-muted-foreground md:block">
          {comSupabase
            ? <><div className="truncate">{sessao.user.email}</div><button className="mt-1 underline" onClick={() => supabase.auth.signOut()}>Sair</button></>
            : 'Rodando neste computador'}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-b px-4 py-4 md:px-8">
          <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
        </header>
        <main className="px-4 py-5 md:px-8"><Tela /></main>
        <footer className="px-4 pb-6 text-xs text-muted-foreground md:px-8">
          A API do Mercado Livre informa posição no ranking, não quantidade vendida. Vendas e faturamento, quando aparecem, são estimativas do JoomPulse. Preço do Alibaba é preço de anúncio, não cotação FOB.
        </footer>
      </div>
    </div>
  );
}
