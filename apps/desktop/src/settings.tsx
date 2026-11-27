import { useT } from "@feito/ui/components/language";
import { useSyncExternalStore } from "react";
import { useApp } from "@feito/ui/components/app";
import { PageHeader } from "@feito/ui/components/chrome";
import { AgendaSettings, AppearanceSettings, ArchivedSettings, SettingsTabs, SettingsVersion } from "@feito/ui/components/settings";
import { version } from "../src-tauri/tauri.conf.json";
import { desktop } from "./data/native";
import { SpaceManager } from "./spaces";

/**
 * Mesmos grupos dos Ajustes do web, com os espaços de trabalho no topo.
 * Importação e backup entram quando o modo local e o transporte remoto tiverem essas rotas.
 */
export function DesktopSettings() {
  const t = useT();
  const app = useApp();
  const status = useSyncExternalStore(desktop.subscribe, desktop.getStatus);

  return (
    <>
      <PageHeader crumb={t("Espaços e preferências")} mobileTitle={t("Ajustes")} back="/navegar" />
      <div className="content">
        <div className="settings">
          <div className="page-h">
            <h1 className="title">{t("Ajustes")}</h1>
            <p className="hint">{t("Espaços, preferências e seus dados.")}</p>
          </div>
          <SettingsTabs tabs={[
            { id: "aparencia", label: t("Aparência"), content: <AppearanceSettings /> },
            { id: "fuso", label: t("Fuso horário"), content: <AgendaSettings /> },
            { id: "arquivados", label: t("Projetos arquivados"), content: <ArchivedSettings /> },
            { id: "espacos", label: t("Espaços de trabalho"), content: <SpaceManager status={status} confirm={app.confirm} /> },
          ]} />
          <SettingsVersion version={version} />
        </div>
      </div>
    </>
  );
}
