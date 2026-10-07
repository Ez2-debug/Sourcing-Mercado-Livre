import React, { useCallback, useEffect, useState } from 'react';
import { COTACAO_URL, carregarEmAlta, carregarVisaoGeral, comSupabase, supabase } from './fonte.js';

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const preco = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
const dia = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function hora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? h : `${dia(iso)} ${h}`;
}

// As fotos e os links vem do banco: so entram na pagina os enderecos esperados.
const fotoSegura = (u) => (typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.mlstatic\.com\//i.test(u) ? u : null);
const linkSeguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

// Carrega ao abrir e a cada `intervalo` ms; devolve { dados, erro, carregando }.
function useDados(carregar, intervalo) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  useEffect(() => {
    let vivo = true;
    const buscar = () => carregar().then(
      (dados) => vivo && setEstado({ dados, erro: null, carregando: false }),
      (err) => vivo && setEstado((e) => ({ dados: e.dados, erro: err.message, carregando: false })),
    );
    buscar();
    const t = intervalo ? setInterval(buscar, intervalo) : null;
    return () => { vivo = false; clearInterval(t); };
  }, [carregar, intervalo]);
  return estado;
}

function Foto({ src, classe }) {
  const ok = fotoSegura(src);
  return ok ? <img className={classe} src={ok} alt="" loading="lazy" /> : <div className={`${classe} semfoto`}>sem foto</div>;
}

function Nome({ nome, link }) {
  const href = linkSeguro(link);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{nome}</a> : <span>{nome}</span>;
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

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
    if (error) setErro('E-mail ou senha não conferem.');
    setEnviando(false);
  }

  return (
    <div className="login">
      <form className="cartao" onSubmit={entrar}>
        <div className="marca"><span className="logo">C</span><span>Conecta Hub Sourcing<small>Produtos em alta para importar</small></span></div>
        <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Senha<input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        {erro && <p className="aviso">{erro}</p>}
        <button className="principal" disabled={enviando}>{enviando ? 'Entrando' : 'Entrar'}</button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Visao geral                                                         */
/* ------------------------------------------------------------------ */

function Tile({ rotulo, valor, nota }) {
  return <div className="tile"><div className="tile-label">{rotulo}</div><div className="tile-valor">{valor}</div><div className="tile-nota">{nota}</div></div>;
}

function VisaoGeral() {
  const { dados: d, erro, carregando } = useDados(carregarVisaoGeral, 15000);
  if (carregando && !d) return <p className="vazio">Carregando.</p>;
  if (!d) return <p className="aviso">{erro}</p>;
  return (
    <>
      {erro && <p className="aviso">{erro}</p>}
      <section className="tiles">
        <Tile rotulo="Categorias mineradas hoje" valor={d.hoje.categorias} nota={d.ultima_mineracao ? `última às ${hora(d.ultima_mineracao)}` : 'nenhuma ainda'} />
        <Tile rotulo="Produtos lidos hoje" valor={d.hoje.produtos} nota="com detalhe de catálogo" />
        <Tile rotulo="Aptos para cotação" valor={d.hoje.aptos} nota="sem marca conhecida nem alerta" />
        <Tile rotulo="Categorias acompanhadas" valor={d.categorias_acompanhadas} nota="mineradas em rodízio" />
      </section>
      <div className="colunas">
        <section className="cartao">
          <h2>Sugestões de hoje</h2>
          <p className="suave">Produtos aptos com maior prioridade de triagem. A prioridade é regra de triagem, não medida de demanda.</p>
          <div className="sugs">
            {!d.hoje.sugestoes.length && <p className="vazio">Ainda não há produto apto minerado hoje.</p>}
            {d.hoje.sugestoes.map((s) => (
              <div className="sug" key={s.id || s.link || s.nome}>
                <Foto src={s.foto} classe="sug-foto" />
                <div>
                  <div className="sug-nome"><Nome nome={s.nome} link={s.link} /></div>
                  <p className="suave">{[s.categoria, preco(s.menor_preco), `prioridade ${s.prioridade}`, s.ncm ? `NCM sugerida ${s.ncm}` : ''].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="cartao">
          <h2>Últimas minerações</h2>
          <p className="suave">Cada categoria é lida de novo a cada ciclo; é isso que forma o histórico de ranking.</p>
          <div className="rolagem">
            <table>
              <thead><tr><th>Horário</th><th>Categoria</th><th className="num">Produtos</th><th className="num">Aptos</th></tr></thead>
              <tbody>
                {!d.historico.length && <tr><td colSpan="4" className="vazio">Nenhuma mineração ainda.</td></tr>}
                {d.historico.map((h) => (
                  <tr key={h.id}><td>{hora(h.quando)}</td><td>{h.categoria}</td><td className="num">{h.produtos}</td><td className="num">{h.aptos}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
    return <a className="botao" href={COTACAO_URL.replace('{pedido}', encodeURIComponent(textoDoPedido(produto)))} target="_blank" rel="noopener noreferrer">Cotar importação</a>;
  }
  const copiar = () => navigator.clipboard.writeText(textoDoPedido(produto)).then(() => {
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  });
  return <button onClick={copiar}>{copiado ? 'Copiado' : 'Copiar pedido de cotação'}</button>;
}

function Produto({ p }) {
  return (
    <article className="produto">
      <Foto src={p.foto} classe="produto-foto" />
      {p.subiu
        ? <span className="selo">▲ {p.subiu} · {p.posicao_anterior}º → {p.posicao}º</span>
        : <span className="selo novo">Entrou em {p.posicao}º</span>}
      <div className="produto-nome"><Nome nome={p.nome} link={p.link} /></div>
      {typeof p.menor_preco === 'number' && <div className="preco">{preco(p.menor_preco)}</div>}
      <p className="suave">{[p.categoria, p.ncm ? `NCM sugerida ${p.ncm}` : '', `comparado com ${dia(p.comparado_com)}`].filter(Boolean).join(' · ')}</p>
      <Cotar produto={p} />
    </article>
  );
}

function resumoDaAlta(a) {
  if (!a.categorias_comparadas) {
    return 'Ainda não há duas minerações da mesma categoria para comparar. O histórico começa a aparecer no segundo ciclo.';
  }
  let t = `${a.categorias_comparadas} categorias comparadas · ${a.total_subindo} produtos aptos subiram · ${a.total_entraram} entraram.`;
  if (a.menor_periodo_em_dias !== null && a.menor_periodo_em_dias < a.dias_pedidos) {
    t += ` O histórico ainda é mais curto que ${a.dias_pedidos} dias: há categoria comparada com ${a.menor_periodo_em_dias.toLocaleString('pt-BR')} dia(s) atrás. A data de comparação aparece em cada produto.`;
  }
  if (a.categorias_sem_historico) t += ` ${a.categorias_sem_historico} categorias ainda têm uma mineração só.`;
  return t;
}

function EmAlta() {
  const [dias, setDias] = useState(7);
  const carregar = useCallback(() => carregarEmAlta(dias), [dias]);
  const { dados: a, erro, carregando } = useDados(carregar, 0);
  return (
    <>
      <div className="barra-alta">
        <h2>Produtos em alta</h2>
        <span className="periodos">
          {[7, 30].map((n) => <button key={n} aria-pressed={dias === n} onClick={() => setDias(n)}>{n} dias</button>)}
        </span>
      </div>
      {erro && <p className="aviso">{erro}</p>}
      {carregando && !a && <p className="vazio">Carregando.</p>}
      {a && (
        <>
          <p className="suave">{resumoDaAlta(a)}</p>
          <h2 className="secao">Subindo no ranking</h2>
          <div className="grade-alta">
            {!a.subindo.length && <p className="vazio">Nenhum produto apto subiu no período.</p>}
            {a.subindo.map((p) => <Produto key={p.id} p={p} />)}
          </div>
          <h2 className="secao">Entraram entre os mais bem colocados</h2>
          <div className="grade-alta">
            {!a.entraram.length && <p className="vazio">Nenhum produto apto entrou no período.</p>}
            {a.entraram.map((p) => <Produto key={p.id} p={p} />)}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Aplicativo                                                          */
/* ------------------------------------------------------------------ */

const TELAS = [['alta', 'Em alta', EmAlta], ['geral', 'Visão geral', VisaoGeral]];

export default function App() {
  const [sessao, setSessao] = useState(undefined);
  const [tela, setTela] = useState('alta');

  useEffect(() => {
    if (!comSupabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (comSupabase && sessao === undefined) return null;
  if (comSupabase && !sessao) return <Login />;

  const Tela = TELAS.find(([id]) => id === tela)[2];
  return (
    <>
      <header>
        <div className="faixa">
          <div className="marca"><span className="logo">C</span><span>Conecta Hub Sourcing<small>Produtos em alta para importar · Mercado Livre Brasil</small></span></div>
          {comSupabase
            ? <><span className="suave">{sessao.user.email}</span><button onClick={() => supabase.auth.signOut()}>Sair</button></>
            : <span className="pilula pausado">Demonstração local</span>}
        </div>
        <nav role="tablist">
          {TELAS.map(([id, rotulo]) => <button key={id} role="tab" aria-selected={tela === id} onClick={() => setTela(id)}>{rotulo}</button>)}
        </nav>
      </header>
      <main><Tela /></main>
      <footer>A API do Mercado Livre informa posição no ranking, não quantidade vendida. Os alertas regulatórios vêm de palavras-chave e precisam ser conferidos pela NCM.</footer>
    </>
  );
}
