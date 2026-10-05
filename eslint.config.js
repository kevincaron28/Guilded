import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["companion-app/**", "dist/**", "node_modules/**", "backups/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["worker/**/*.mjs"], languageOptions: { globals: { Request: "readonly", Response: "readonly", Headers: "readonly" } } },
  { files: ["site/**/*.js"], languageOptions: { globals: { document: "readonly", navigator: "readonly", URL: "readonly" } } },
  {
    ignores: ["dist/**", "companion-app/**", "node_modules/**", "prisma/migrations/**"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        structuredClone: "readonly"
      }
    }
  }
);
