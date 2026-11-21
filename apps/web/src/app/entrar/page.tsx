import type { Metadata } from "next";
import { BrowserApp } from "@/components/browser-app";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return <BrowserApp />;
}
