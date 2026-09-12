import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fluxo — Gestão de estudos",
  description: "Planeje ciclos, registre sessões e acompanhe sua evolução nos estudos.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
