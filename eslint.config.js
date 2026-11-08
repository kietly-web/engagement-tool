import js from "@eslint/js";
import tseslint from "typescript-eslint";

const DB_DRIVERS = ["pg", "postgres", "@neondatabase/serverless", "@electric-sql/pglite"];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "apps/worker/public/**", "**/.wrangler/**", "**/worker-configuration.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: DB_DRIVERS.map((name) => ({ name, message: "Only packages/db talks to Postgres (CLAUDE.md)." })) },
      ],
    },
  },
  {
    files: ["packages/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: DB_DRIVERS.map((name) => ({ name, message: "packages/core has no I/O." })),
          patterns: [{ group: ["@et/*"], message: "packages/core imports no other package." }],
        },
      ],
    },
  },
  {
    files: ["packages/db/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["apps/web/**", "apps/overlay/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: DB_DRIVERS.map((name) => ({ name, message: "Browser apps never reach the database." })),
          patterns: [
            {
              regex: "^@et/(?!worker/api-types$)",
              message: "Browser apps depend only on the API's shared types (@et/worker/api-types).",
            },
          ],
        },
      ],
    },
  },
);
