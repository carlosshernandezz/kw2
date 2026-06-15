import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KW2 Mesa',
  description: 'Sistema interno KW2',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-800">
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
            <div className="px-5 py-4 text-lg font-semibold text-slate-900">KW2 Mesa</div>
            <nav className="flex flex-col gap-1 px-3 text-sm">
              <a className="rounded-md px-3 py-2 font-medium text-slate-700 hover:bg-slate-100" href="/">
                Inicio
              </a>
              <a
                className="rounded-md bg-slate-100 px-3 py-2 font-medium text-slate-900"
                href="/conciliacion/binance"
              >
                Conciliación Binance
              </a>
              <span className="px-3 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Próximamente
              </span>
              <span className="rounded-md px-3 py-2 text-slate-400">Saldos de clientes</span>
              <span className="rounded-md px-3 py-2 text-slate-400">Saldos por cuenta</span>
              <span className="rounded-md px-3 py-2 text-slate-400">Utilidades y KPIs</span>
            </nav>
          </aside>
          <main className="flex-1 px-8 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
