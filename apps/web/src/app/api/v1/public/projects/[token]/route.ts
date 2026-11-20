import "server-only";
import { z } from "zod";
import { notFound } from "@/server/errors";
import { json, readQuery, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { getPublicProject } from "@/server/services/project-sharing";
import { projectPageQuery } from "@feito/core/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shareToken = z.uuidv4().transform((value) => value.toLowerCase());

export const GET = route("/api/v1/public/projects/{token}", "public_project", async (
  request, context: { params: Promise<{ token: string }> },
) => {
  const token = shareToken.safeParse((await context.params).token);
  if (!token.success) throw notFound();
  const { includeCompleted } = readQuery(request, projectPageQuery);
  const { db, keys } = getRuntime();
  const project = await getPublicProject({ db, keys }, token.data, includeCompleted);
  return json(project, 200, { "X-Robots-Tag": "noindex" });
});
