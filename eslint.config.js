// @ts-check

import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import { globalIgnores } from "eslint/config"

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  globalIgnores(["dist/**", ".wrangler/**", "coverage/**", "worker-configuration.d.ts"]),
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
