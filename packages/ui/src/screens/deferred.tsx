"use client";

import { lazyScreen } from "../components/lazy-screen";

export const Today = lazyScreen(() => import("./today"));
export const Inbox = lazyScreen(() => import("./inbox"));
export const Upcoming = lazyScreen(() => import("./upcoming"));
export const Search = lazyScreen(() => import("./search"));
export const Browse = lazyScreen(() => import("./browse"));
export const Label = lazyScreen(() => import("./label"));
export const ProjectView = lazyScreen(async () => ({ default: (await import("../components/project-view")).ProjectView }));
