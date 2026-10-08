// Componentes de base no estilo do shadcn/ui: pequenos, sem estado, compostos
// por classes do Tailwind sobre as variaveis do tema (estilos.css).

import React from 'react';

const junta = (...partes) => partes.filter(Boolean).join(' ');

export function Card({ className, children }) {
  return <section className={junta('rounded-lg border bg-card p-5 shadow-xs', className)}>{children}</section>;
}

export function CardTitulo({ titulo, descricao, acao }) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div className="mr-auto min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{titulo}</h2>
        {descricao && <p className="mt-0.5 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acao}
    </div>
  );
}

const VARIANTES_DE_BOTAO = {
  primario: 'bg-primary text-primary-foreground hover:brightness-110',
  contorno: 'border bg-card hover:bg-muted',
  fantasma: 'hover:bg-muted',
};

export function Botao({ variante = 'contorno', pequeno, className, ...props }) {
  return (
    <button
      className={junta(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition disabled:opacity-50',
        pequeno ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        VARIANTES_DE_BOTAO[variante],
        className,
      )}
      {...props}
    />
  );
}

const TONS = {
  neutro: 'bg-muted text-muted-foreground',
  primario: 'bg-accent text-primary',
  ok: 'bg-success-soft text-success',
  alerta: 'bg-warning-soft text-warning',
  erro: 'bg-danger-soft text-danger',
};

export function Selo({ tom = 'neutro', className, children }) {
  return <span className={junta('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums', TONS[tom], className)}>{children}</span>;
}

export function Indicador({ rotulo, valor, nota, icone: Icone }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{rotulo}</span>
        {Icone && <Icone className="size-4" aria-hidden="true" />}
      </div>
      <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{nota}</div>
    </div>
  );
}

export function Tabela({ colunas, children, vazio }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {colunas.map((c) => <th key={c.titulo} className={junta('px-2 py-2 font-medium whitespace-nowrap', c.num && 'text-right')}>{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:px-2 [&_td]:py-2 [&_td]:align-top [&_tr:last-child_td]:border-0">
          {children}
          {vazio && <tr><td colSpan={colunas.length} className="py-6 text-center text-muted-foreground">{vazio}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Aviso({ children }) {
  return <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>;
}

export function Carregando() {
  return <p className="py-6 text-sm text-muted-foreground">Carregando.</p>;
}
