import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  queueMicrotask: "readonly",
  fetch: "readonly",
  structuredClone: "readonly",
};

// The src/ tree mirrors the original Python code during the parity phase, so the
// style rules that fire on that code base are warnings; real bug classes stay errors.
export default tseslint.config(
  {
    ignores: ["dist/**", "dist-pack/**", "coverage/**", "node_modules/**", ".ki-dist/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mjs,js}"],
    languageOptions: { globals: nodeGlobals },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "no-control-regex": "off",
      "no-useless-assignment": "warn",
      "no-useless-catch": "warn",
      "prefer-const": "warn",
      "require-yield": "off",
    },
  },
);
