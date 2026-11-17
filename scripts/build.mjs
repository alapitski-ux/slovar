// Builds docs/app.js (React bundled, JSX compiled) and copies the stylesheet.
// Usage: npm run build
import { build } from "esbuild";
import { readFileSync, copyFileSync } from "node:fs";

const header = 'import React from "react";\nimport { createRoot } from "react-dom/client";\nconst ReactDOM = { createRoot };\n';
const code = header + readFileSync("src/app.jsx", "utf8");

await build({
  stdin: { contents: code, loader: "jsx", resolveDir: process.cwd(), sourcefile: "app.jsx" },
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari15", "chrome100"],
  outfile: "docs/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
copyFileSync("src/style.css", "docs/style.css");
console.log("built docs/app.js");
