import { defineProject } from "vitest/config";

// These suites run against in-process Postgres (PGlite); shared CI runners are slower than local machines.
export default defineProject({
  test: { testTimeout: 20_000, hookTimeout: 20_000 },
});
