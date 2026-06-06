// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Generated output and local runtime state are never linted. The web app is a
    // separate Vite project with its own tsconfig/build; its source and bundle are
    // linted there (tsc --noEmit), not by the backend's eslint.
    ignores: ["dist/**", "coverage/**", ".trigger/**", ".data/**", "web/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `npm run build` (tsc) is the source of truth for undefined identifiers and
      // already knows Node + vitest globals via tsconfig "types"; no-undef is redundant
      // here and would false-positive on those globals.
      "no-undef": "off",
      // Intentionally-unused args/vars are allowed when prefixed with _ (common in the
      // tool/adapter interfaces where a signature is fixed but not every param is used).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Must stay last: turns off every stylistic rule that would conflict with Prettier.
  prettier,
);
