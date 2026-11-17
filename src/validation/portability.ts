import { z } from "zod";

export const importCounts = z.strictObject({
  projects: z.number().int().nonnegative(),
  archivedProjects: z.number().int().nonnegative(),
  sections: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  labels: z.number().int().nonnegative(),
  occurrences: z.number().int().nonnegative(),
});

export type ImportCounts = z.infer<typeof importCounts>;
