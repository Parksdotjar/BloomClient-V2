import fs from "node:fs";
import assert from "node:assert/strict";
import postcss from "postcss";

// Check all UI sheets, including portal-only components. Real artwork stays theme-independent.
const files = ["src/styles.css", ...fs.readdirSync("src/components").filter(file => file.endsWith(".css") && file !== "organic-background.css").map(file => `src/components/${file}`)];
const palettes = ["light"].map(name => {
  const values = new Map();
  postcss.parse(fs.readFileSync(`src/themes/${name}.css`, "utf8")).walkDecls(decl => {
    if (decl.prop.startsWith("--") && decl.parent.selector === `:root[data-theme="${name}"]`) values.set(decl.prop, decl.value);
  });
  return { name, values };
});
function outsideVariables(value) {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    if (value.slice(index, index + 4) === "var(") {
      let depth = 1;
      index += 4;
      for (; index < value.length && depth; index++) {
        if (value[index] === "(") depth++;
        if (value[index] === ")") depth--;
      }
      index--;
    } else result += value[index];
  }
  return result;
}
const failures = [];
let declarations = 0;
for (const file of files) {
  postcss.parse(fs.readFileSync(file, "utf8")).walkDecls(decl => {
    const selector = decl.parent.selector || "";
    if (selector.includes("[data-theme=")) return;
    for (const token of decl.value.matchAll(/var\((--theme-[\w-]+)/g)) {
      for (const { name, values } of palettes) if (!values.has(token[1])) failures.push(`${file}:${decl.source.start.line}: undefined ${token[1]} in ${name}`);
    }
    if (decl.prop.startsWith("--") || /url\(/i.test(decl.value)) return;
    if (file.endsWith("screenshot-comparison.css") && /comparison-(?:canvas|left|image|divider|handle|side)/.test(selector)) return;
    if (/background/.test(decl.prop) && /accent-(?:saturation-field|hue-control)/.test(selector)) return;
    if (/border|outline/.test(decl.prop) && /accent-(?:saturation-field i|hue-control.*thumb)/.test(selector)) return;
    if (!/color|background|border|outline|shadow|fill|stroke|filter/.test(decl.prop)) return;
    declarations++;
    if (/#[\da-f]{3,8}\b|rgba?\(|\b(?:white|black)\b/i.test(outsideVariables(decl.value))) failures.push(`${file}:${decl.source.start.line}: unthemed ${decl.prop} in ${selector}`);
  });
}
assert.deepEqual(failures, [], failures.join("\n"));
function luminance(hex) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
}
for (const { name, values } of palettes) {
for (const [ink, surface] of [["--text", "--panel"], ["--muted", "--page"], ["--muted", "--control"], ...["success", "danger", "warning", "info", "violet"].map(tone => [`--theme-${tone}-ink`, `--theme-${tone}-surface`])]) {
  const a = luminance(values.get(ink)), b = luminance(values.get(surface));
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${name}: ${ink} needs readable contrast on ${surface}`);
}
}
console.log(`Theme audit passed: ${files.length} UI stylesheets, ${declarations} color declarations, Light token coverage and contrast.`);
