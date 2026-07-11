import { router } from "@slsv/sdk";
import { healthRoutes } from "./health";
import { linkRoutes } from "./links";

// Root API loader — slsv.yml functions.api.handler points here (./backend/routes/route.handler).
// Each feature folder exports a <feature>Routes array; spread them all into one router.
// New feature = new folder + one import + one spread below.
export const handler = router([...linkRoutes, ...healthRoutes]);
