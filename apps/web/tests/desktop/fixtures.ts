import { expect, test as base, type Page } from "@playwright/test";
import type { Bridge } from "../../../desktop/src/data/desktop";

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    expect(errors, "Erros não tratados na interface do desktop").toEqual([]);
  },
});

/** Simula a fronteira nativa, mantendo a detecção do Tauri e a barra de título reais. */
export async function mockDesktop(page: Page, initial: Awaited<ReturnType<Bridge["read"]>>, simulateServer = false) {
  await page.addInitScript(({ initial, simulateServer }) => {
    let stored = initial;
    let callbackId = 0;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: () => ++callbackId,
        unregisterCallback: () => undefined,
        async invoke(command: string, args?: { generation: number | null; value: NonNullable<typeof initial>["value"]; path?: string; body?: { email: string }; origin?: string }) {
          switch (command) {
            case "read_workspace": return structuredClone(stored);
            case "write_workspace": {
              if (!args || args.generation !== (stored?.generation ?? null)) throw new Error("Geração inválida");
              stored = { generation: (args.generation ?? 0) + 1, value: structuredClone(args.value) };
              return structuredClone(stored);
            }
            case "server_request": {
              if (!simulateServer) throw new Error("Servidor indisponível na prévia");
              const server = stored?.value.server;
              if (!server) throw new Error("Servidor não configurado");
              if (args?.path === "/api/v1/auth/logout") return { status: 204, body: null };
              if (args?.path === "/api/v1/auth/login") return { status: 200, body: { user: { ...server.user, email: args.body?.email }, mustChangePassword: false } };
              return { status: 200, body: { user: { ...server.user, email: args?.body?.email ?? server.user.email }, cursor: 0, workspace: server.confirmed } };
            }
            case "start_product_events": return ++callbackId;
            case "stop_product_events": return;
            case "plugin:window|is_maximized":
            case "plugin:window|is_fullscreen": return false;
            case "plugin:window|is_focused": return true;
            case "plugin:event|listen": return ++callbackId;
            case "plugin:event|unlisten": return;
            default: throw new Error(`Comando inesperado: ${command}`);
          }
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
    });
  }, { initial, simulateServer });
}
