"use client";

import { useT } from "../components/language";

import { BrowsePanel, PageHeader } from "../components/chrome";

export default function BrowsePage() {
  const t = useT();
  return (
    <>
      <PageHeader crumb={t("Projetos, etiquetas e ajustes")} mobileTitle={t("Navegar")} />
      <div className="content">
        <div className="page-h"><h1 className="title">{t("Navegar")}</h1></div>
        <BrowsePanel />
      </div>
    </>
  );
}
