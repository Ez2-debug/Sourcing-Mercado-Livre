import React, { useEffect, useRef } from 'react';

// Texto de ajuda: a aba "Como funciona" e a janela que abre na primeira visita.

const PASSOS = [
  ['Descubra', 'Radar e Mais vendidos', 'Veja o que está vendendo agora em cada marketplace e no Paraguai. Filtre por categoria e por gênero para chegar no seu nicho.'],
  ['Confirme', 'Importados → Brasil e ML Internacional', 'Confira se o produto já é comprado de fora (China e EUA) e se aparece em mais de um canal. Produto que vende em dois lugares é demanda confirmada.'],
  ['Cote', 'China (JoomPro), Alibaba e Cotações', 'Compare o custo de trazer o produto com o preço de venda no Brasil. As cotações do Alibaba chegam pelo Accio Work.'],
  ['Decida', 'Razão', 'Monte a planilha do produto, com custo, câmbio, frete, impostos e margem, e decida com os números lado a lado.'],
];

const FONTES = [
  ['Mercado Livre (Brasil e México)', 'API oficial do Mercado Livre: ranking dos mais vendidos por categoria, minerado todo dia às 08:00.', 'diário'],
  ['Mais vendidos e Compra Internacional', 'JoomPulse: vendas e faturamento estimados no Mercado Livre e na Shopee, e catálogo de fornecedores da China (JoomPro).', 'semanal'],
  ['Shopee', 'JoomPulse, a partir do contador público de vendidos da Shopee.', 'semanal'],
  ['Paraguai · aduana', 'Dados abertos da aduana do Paraguai: o que entrou no país no último mês, por NCM.', 'mensal'],
  ['Paraguai · lojas', 'Compras Paraguai: o que os brasileiros mais procuram nas lojas de lá.', 'diário'],
  ['Paraguai · ONU', 'UN Comtrade: crescimento anual das importações por tipo de produto.', 'mensal'],
  ['Câmbio', 'Dólar PTAX do Banco Central.', 'diário'],
];

const LEITURA = [
  'Vendas e faturamento são estimativas do JoomPulse, nunca números oficiais. No Mercado Livre, "vendas/mês" é a média mensal da vida do produto.',
  'A posição no ranking do Mercado Livre mostra ordem, não quantidade vendida.',
  'Produto de marca de terceiros (Apple, Samsung, Nintendo...) mostra demanda, mas revender exige autorização do dono da marca.',
  'Selos Anvisa, Anatel e Inmetro avisam que o produto precisa de registro ou certificação antes de importar.',
  'A NCM é uma sugestão para o despachante, sem alíquota.',
  'O par entre um fornecedor da China e um anúncio do Mercado Livre é automático: confira se é o mesmo produto antes de comprar.',
];

function Conteudo({ curto }) {
  return (
    <div className="grid gap-6 text-sm">
      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">O caminho de um produto</h3>
        <ol className="grid gap-3 sm:grid-cols-2">
          {PASSOS.map(([verbo, telas, texto], i) => (
            <li key={verbo} className="rounded-md border p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-primary">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-semibold">{verbo}</span>
                <span className="text-xs text-muted-foreground">· {telas}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{texto}</p>
            </li>
          ))}
        </ol>
      </section>
      {!curto && (
        <section>
          <h3 className="mb-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">De onde vêm os dados</h3>
          <table className="w-full text-left">
            <tbody className="divide-y">
              {FONTES.map(([nome, origem, quando]) => (
                <tr key={nome}>
                  <td className="py-2 pr-4 align-top font-medium whitespace-nowrap">{nome}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{origem}</td>
                  <td className="py-2 text-right align-top font-mono text-xs text-muted-foreground">{quando}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section>
        <h3 className="mb-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Como ler os números</h3>
        <ul className="grid gap-2">
          {(curto ? LEITURA.slice(0, 3) : LEITURA).map((t) => (
            <li key={t} className="flex gap-2 text-muted-foreground"><span className="text-primary">—</span><span>{t}</span></li>
          ))}
        </ul>
      </section>
      {!curto && (
        <section>
          <h3 className="mb-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Atualização</h3>
          <p className="text-muted-foreground">
            O minerador roda sozinho num computador da equipe e envia os dados para este site. Mercado Livre, Paraguai e câmbio se atualizam
            todos os dias; as leituras do JoomPulse (mais vendidos, Shopee, Compra Internacional e China) são feitas uma vez por semana,
            porque a cota de consultas é mensal. A data de cada leitura aparece no topo de cada lista.
          </p>
        </section>
      )}
    </div>
  );
}

export function ComoFunciona() {
  return (
    <div className="max-w-4xl rounded-lg border bg-card p-6">
      <p className="mb-6 text-base">
        O Conecta Market Sourcing junta, num lugar só, o que está vendendo nos marketplaces do Brasil, o que o brasileiro compra de fora e o
        que cresce no Paraguai, para você escolher o que importar com base em dados, não em palpite.
      </p>
      <Conteudo />
    </div>
  );
}

// Janela da primeira visita. Fecha com Esc, no X ou clicando fora.
export function JanelaDeAjuda({ aberta, aoFechar, aoVerTudo }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!aberta) return undefined;
    const tecla = (e) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', tecla);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', tecla);
  }, [aberta, aoFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={aoFechar}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titulo-ajuda"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start gap-3">
          <div className="mr-auto">
            <h2 id="titulo-ajuda" className="text-lg font-semibold">Como a ferramenta funciona</h2>
            <p className="text-sm text-muted-foreground">Quatro passos, do produto em alta até a decisão de importar.</p>
          </div>
          <button onClick={aoFechar} aria-label="Fechar" className="grid size-8 place-items-center rounded-md border text-muted-foreground hover:bg-muted">✕</button>
        </div>
        <Conteudo curto />
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button onClick={aoVerTudo} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">Ver explicação completa</button>
          <button onClick={aoFechar} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Começar</button>
        </div>
      </div>
    </div>
  );
}
