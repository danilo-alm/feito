import type { Metadata } from "next";
import { PublicProjectView } from "@/components/public-project";

export const metadata: Metadata = {
  title: "Projeto compartilhado",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicProjectView key={token} token={token} />;
}
