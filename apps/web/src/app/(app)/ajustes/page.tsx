"use client";
import { PageHeader } from "@feito/ui/components/chrome";
import { AgendaSettings, AppearanceSettings, ArchivedSettings } from "@feito/ui/components/settings";
import { AccountSettings, DataSettings } from "@/components/settings";

export default function SettingsPage() {
  return (
    <>
      <PageHeader crumb="Conta e preferências" mobileTitle="Ajustes" back="/navegar" />
      <div className="content">
        <div className="settings">
          <div className="page-h">
            <h1 className="title">Ajustes</h1>
            <p className="hint">Conta, preferências e seus dados.</p>
          </div>
          <AppearanceSettings />
          <AgendaSettings />
          <AccountSettings />
          <DataSettings />
          <ArchivedSettings />
        </div>
      </div>
    </>
  );
}
