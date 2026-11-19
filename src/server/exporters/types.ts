import "server-only";
import type { Product, Project } from "@/domain/product";

export type ExportFile = { fileName: string; contentType: string; body: string };

export type Exporter = (product: Product, project: Project, options: Record<string, boolean>) => ExportFile;
