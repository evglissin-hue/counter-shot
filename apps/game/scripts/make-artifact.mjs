// Turns the Vite build into a claude.ai artifact page: the artifact service adds
// its own doctype, head and body, so the page keeps only its title, styles,
// content and scripts. Writes dist/artifact.html next to dist/assets/.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`markers ${a} / ${b} not found`);
  return html.slice(i + a.length, j).trim();
};
const head = between("<!-- artifact-head-start -->", "<!-- artifact-head-end -->");
const body = between("<!-- artifact-body-start -->", "<!-- artifact-body-end -->");
// Vite puts its module script and preloads in <head>; keep them, after the content.
const tags = [...html.matchAll(/<(script|link)\b[^>]*(?:type="module"|rel="modulepreload")[^>]*>(?:<\/script>)?/g)].map((m) => m[0]);
const out = `${head}\n${body}\n${tags.join("\n")}\n`;
writeFileSync(new URL("../dist/artifact.html", import.meta.url), out);
console.log(`dist/artifact.html: ${out.length} bytes, scripts: ${tags.length}`);
