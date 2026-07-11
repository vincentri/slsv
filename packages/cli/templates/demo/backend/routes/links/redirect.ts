import { get, json, queue, redirect } from "@slsv/sdk";
import { store } from "../../lib/store";

const clicks = queue("clicks");

// GET /r/{id} — different prefix than the group, so links/index.ts adds it un-grouped. Also
// served at the root via slsv.yml's explicit `GET /r/{code}` entry (short-link vanity path).
export const redirect_ = get("/r/{id}", async (req) => {
  const link = store.get(req.params.id);
  if (!link) return json({ error: "not found" }, 404);

  await clicks.send({ id: link.id, ts: Date.now() }, { delaySeconds: 0 });
  return redirect(link.url, 301);
});
