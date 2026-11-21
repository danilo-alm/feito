import type { Metadata } from "next";
import { AppProviders } from "@feito/ui/components/app";
import { PublicProjectView } from "@/components/public-project";

export const metadata: Metadata = {
  title: "Projeto compartilhado",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AppProviders><PublicProjectView key={token} token={token} /></AppProviders>;
}
