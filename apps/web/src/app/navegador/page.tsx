import { BrowserApp } from "@/components/browser-app";

// Esta entrada pública é compilada uma vez e só resolve sessão e espaço no navegador.
export const dynamic = "error";

export default function BrowserPage() {
  return <BrowserApp />;
}
