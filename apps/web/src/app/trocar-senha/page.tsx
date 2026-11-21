import type { Metadata } from "next";
import { BrowserApp } from "@/components/browser-app";

export const metadata: Metadata = { title: "Senha" };

export default function ChangePasswordPage() {
  return <BrowserApp />;
}
