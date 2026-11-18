"use client";
import { BrowsePanel, PageHeader } from "@/components/chrome";

export default function BrowsePage() {
  return (
    <>
      <PageHeader crumb="Projetos, etiquetas e ajustes" mobileTitle="Navegar" />
      <div className="content">
        <div className="page-h"><h1 className="title">Navegar</h1></div>
        <BrowsePanel />
      </div>
    </>
  );
}
