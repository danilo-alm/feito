import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { ACCOUNTS_FILE, AUTH_DIR } from "./global-setup";

type Account = { email: string; password: string };
export type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

function accounts(): Record<string, Account> {
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

export async function login(page: Page, account: Account) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Senha", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export function apiFor(request: APIRequestContext, origin: string): Api {
  return async (method, path, body) => {
    const response = await request.fetch(`/api/v1${path}`, {
      method,
      headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()} ${await response.text()}`);
    return (response.status() === 204 ? undefined : await response.json()) as never;
  };
}

/** Cada projeto de teste (desktop, celular) usa uma conta própria e entra uma única vez. */
export const test = base.extend<{ api: Api }, { authState: string }>({
  authState: [async ({ browser }, use, workerInfo) => {
    const name = workerInfo.project.name;
    const file = join(AUTH_DIR, `state-${name}.json`);
    if (!existsSync(file)) {
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
      const page = await context.newPage();
      await login(page, accounts()[name]);
      await page.waitForURL("**/hoje");
      await context.storageState({ path: file });
      await context.close();
    }
    await use(file);
  }, { scope: "worker" }],
  storageState: async ({ authState }, use) => use(authState),
  api: async ({ page, baseURL }, use) => use(apiFor(page.request, new URL(baseURL!).origin)),
});

export { expect };

type ProjectSeed = { id: string; sections: Record<string, string>; tasks: Record<string, { id: string }> };

/** Cria um projeto isolado com seções e tarefas no formato dos dados de exemplo do design. */
export async function seedProject(api: Api, name: string): Promise<ProjectSeed> {
  const project = await api<{ id: string }>("POST", "/projects", { name });
  const sections: Record<string, string> = {};
  for (const section of ["Planejar", "Comprar", "Resolver"]) {
    sections[section] = (await api<{ id: string }>("POST", `/projects/${project.id}/sections`, { name: section })).id;
  }
  const tasks: Record<string, { id: string }> = {};
  const add = async (title: string, fields: Record<string, unknown>) => {
    tasks[title] = await api<{ id: string }>("POST", "/tasks", { title, projectId: project.id, ...fields });
    return tasks[title];
  };
  await add("Medir a parede da sala", { description: "Largura para a estante nova", priority: 3 });
  await add("Definir orçamento da reforma", { sectionId: sections.Planejar, priority: 1, description: "Teto de R$ 8 mil" });
  const color = await add("Escolher a cor da pintura do quarto", { sectionId: sections.Planejar, priority: 2 });
  tasks["Pedir amostras na loja"] = await api<{ id: string }>("POST", "/tasks", { title: "Pedir amostras na loja", parentId: color.id });
  await add("Listar móveis para doação", { sectionId: sections.Planejar });
  await add("Lâmpadas para o corredor", { sectionId: sections.Comprar });
  await add("Kit de ferramentas", { sectionId: sections.Comprar, description: "Furadeira, buchas e nível" });
  await add("Ligar para o eletricista", { sectionId: sections.Resolver, priority: 1 });
  return { id: project.id, sections, tasks };
}

type PageTask = { id: string; title: string; sectionId: string | null; parentId: string | null; childIds: string[] };
export async function projectState(api: Api, id: string) {
  const page = await api<{ groups: { sectionId: string | null; rootIds: string[] }[]; tasks: PageTask[] }>("GET", `/projects/${id}`);
  const byTitle = Object.fromEntries(page.tasks.map((task) => [task.title, task]));
  const order = (sectionId: string | null) =>
    (page.groups.find((group) => group.sectionId === sectionId)?.rootIds ?? []).map((taskId) => page.tasks.find((task) => task.id === taskId)!.title);
  return { byTitle, order };
}

export function row(page: Page, title: string) {
  return page.locator("[data-task-id]", { has: page.locator(".t-title", { hasText: new RegExp(`^${title}$`) }) });
}

/**
 * Arrasta com o mouse em passos, como um usuário. Com `aim`, corrige a mira no fim usando a posição
 * atual do alvo, que pode ter mudado com a rolagem automática.
 */
export async function mouseDrag(
  page: Page, from: { x: number; y: number }, to: { x: number; y: number },
  aim?: { locator: ReturnType<Page["locator"]>; zone: "top" | "center" },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  if (aim) {
    await page.waitForTimeout(100);
    const box = (await aim.locator.boundingBox())!;
    await page.mouse.move(box.x + 200, aim.zone === "top" ? box.y + 4 : box.y + box.height / 2, { steps: 4 });
  }
  await page.waitForTimeout(150);
}
