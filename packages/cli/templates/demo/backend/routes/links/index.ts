import { group } from "@slsv/sdk";
import { create } from "./create";
import { list } from "./list";
import { redirect_ } from "./redirect";

// One file per handler; this index collects them. Paths are relative to the API mount
// (slsv.yml `path: /api/{proxy+}`) — API Gateway strips the `/api` prefix, so list/create group
// under '/links' and redirect_ owns '/r/{id}'. Change the mount, the routes inherit it.
// Add an endpoint = new file + one entry here. This file's name never changes, so backend/
// routes/route.ts keeps importing `linkRoutes` no matter how many handlers land here.
export const linkRoutes = [...group("/links", [list, create]), redirect_];
