import "@/server/load-env";
import { runSeed } from "./seed";

runSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
