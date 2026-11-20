import "server-only";
import { taskMutation } from "@/server/http/task-mutation";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteTask, editTask, getTask } from "@/server/services/tasks";
import { editTaskInput, taskDeleteQuery } from "@/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productIdRoute("/api/v1/tasks/{id}", "task", async (_request, access, id) => {
  return json(await getTask(access, id));
});

export const PATCH = productIdRoute("/api/v1/tasks/{id}", "edit_task", async (request, access, id) => {
  return taskMutation(request, access, async (write) => editTask(write, id, await readProductJson(request, editTaskInput)));
});

export const DELETE = productIdRoute("/api/v1/tasks/{id}", "delete_task", async (request, access, id) => {
  const { revision, withChildren } = readQuery(request, taskDeleteQuery);
  return taskMutation(request, access, (write) => deleteTask(write, id, revision, withChildren), 204);
});
