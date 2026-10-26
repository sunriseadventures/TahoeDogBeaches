import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "src", "index.html");
const source = readFileSync(sourcePath, "utf8");

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const wpStart = source.indexOf("<!--WP-->");
const wpEnd = source.indexOf("<!--/WP-->");
check(wpStart !== -1 && wpEnd > wpStart, "WP fragment markers are missing.");
const fragment = source.slice(wpStart + "<!--WP-->".length, wpEnd).trim();

check(!/<!doctype/i.test(fragment), "WordPress fragment includes a document shell.");
check(!fragment.includes("site-header"), "WordPress fragment includes the static header.");
check(!fragment.includes("fonts.googleapis"), "WordPress fragment loads a second copy of the fonts.");
check(!/under development/i.test(source), "Draft notice is still in the page.");
check(!/oninput=|onchange=/i.test(source), "Inline event handlers are still in the page.");

const styleMatch = fragment.match(/<style>([\s\S]*?)<\/style>/);
check(styleMatch, "WordPress fragment is missing its style block.");
const style = styleMatch ? styleMatch[1] : "";
check(!/(^|\n)\s*\*\s*\{/.test(style), "Universal selector would restyle the WordPress theme.");
check(!/(^|\n)\s*body\s*\{/.test(style), "Body selector would restyle the WordPress theme.");
check(!/(^|\n)\s*a\s*\{/.test(style), "Anchor selector would restyle the WordPress theme.");
check(!/site-nav\s*\{[^}]*display:\s*none/.test(style), "Navigation is hidden without a replacement.");

const scriptMatch = fragment.match(/<script>([\s\S]*?)<\/script>/);
check(scriptMatch, "WordPress fragment is missing its script.");
const script = scriptMatch ? scriptMatch[1] : "";
if (script) {
  const syntax = spawnSync(process.execPath, ["--check"], { input: script, encoding: "utf8" });
  check(syntax.status === 0, `Page script failed syntax check.\n${syntax.stderr || ""}`);
}

const dataMatch = script.match(/const beachData = (\[[\s\S]*?\n {8}\]);/);
const filterMatch = script.match(/function filterList\(data, query\) \{[\s\S]*?\n {8}\}/);
check(dataMatch, "Could not read beach data from the page script.");
check(filterMatch, "Could not read filterList from the page script.");

let beachData = [];
let filterList = () => [];
if (dataMatch && filterMatch) {
  beachData = Function(`"use strict"; return (${dataMatch[1]});`)();
  filterList = Function(`"use strict"; ${filterMatch[0]}; return filterList;`)();
}

check(beachData.length === 6, `Expected 6 beaches, found ${beachData.length}.`);
const names = beachData.map((beach) => beach.name);
check(
  names.join("|") ===
    "Kiva Beach|Regan Beach (Dog Area)|Raccoon Street Dog Beach|Carnelian West Beach|Chimney Beach|Hidden Beach",
  `Beach order changed: ${names.join(", ")}`,
);

const cases = [
  [{ search: "kiva", region: "all", leash: "all" }, ["Kiva Beach"]],
  [{ search: "  CHIMNEY ", region: "all", leash: "all" }, ["Chimney Beach"]],
  [{ search: "", region: "East Shore", leash: "all" }, ["Chimney Beach", "Hidden Beach"]],
  [{ search: "", region: "all", leash: "Off-Leash Allowed" }, ["Regan Beach (Dog Area)"]],
  [{ search: "", region: "North Shore", leash: "Off-Leash Allowed" }, []],
  [{ search: "zzzz-no-beach", region: "all", leash: "all" }, []],
];
for (const [query, expected] of cases) {
  const actual = filterList(beachData, query).map((beach) => beach.name);
  check(actual.join("|") === expected.join("|"), `Filter ${JSON.stringify(query)} returned ${actual.join(", ") || "(none)"}.`);
}

const LAB = new Set([
  "PXL_20240813_010905516.PORTRAIT-scaled.jpg",
  "IMG_20200718_202010-1-scaled.jpg",
  "PXL_20220211_013622245-1-scaled.jpg",
  "PXL_20211009_012119910-1-scaled.jpg",
]);
const BW = new Set(["IMG_20210405_134956-1-1-scaled.jpg"]);
function subject(url) {
  const file = String(url).split("/").pop();
  if (LAB.has(file)) return "lab";
  if (BW.has(file)) return "bw";
  return "scene";
}
function adjacentSubjects(urls, columns) {
  const problems = [];
  urls.forEach((url, index) => {
    const column = index % columns;
    const neighbors = [];
    if (column + 1 < columns && index + 1 < urls.length) neighbors.push(index + 1);
    if (index + columns < urls.length) neighbors.push(index + columns);
    for (const neighbor of neighbors) {
      const left = subject(url);
      const right = subject(urls[neighbor]);
      if (left !== "scene" && left === right) {
        problems.push(`${left} photos share an edge at ${columns} columns (${index} and ${neighbor})`);
      }
    }
  });
  return problems;
}

const galleryStart = fragment.indexOf('<div class="tdb-gallery"');
const galleryEnd = fragment.indexOf("<h2", galleryStart);
check(galleryStart !== -1 && galleryEnd > galleryStart, "Gallery markup is missing.");
const galleryHtml = galleryStart === -1 ? "" : fragment.slice(galleryStart, galleryEnd);
const galleryUrls = [...galleryHtml.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
check(galleryUrls.length === 3, `Expected 3 gallery photos, found ${galleryUrls.length}.`);
const cardUrls = beachData.map((beach) => beach.img);
const markup = source.slice(0, source.indexOf("<script>"));
const staticCards = [...markup.matchAll(/<article class="tdb-card">[\s\S]*?<\/article>/g)].map((match) => {
  const img = match[0].match(/<img src="([^"]+)"/);
  return img ? img[1] : "";
});
check(staticCards.join("|") === cardUrls.join("|"), "Static beach cards do not match the filter data.");
check(new Set([...galleryUrls, ...cardUrls]).size === galleryUrls.length + cardUrls.length, "A photo is used more than once.");

for (const [label, urls] of [["gallery", galleryUrls], ["cards", cardUrls]]) {
  for (const columns of [1, 3]) {
    for (const problem of adjacentSubjects(urls, columns)) {
      failures.push(`${label}: ${problem}`);
    }
  }
}

const imageUrls = [...source.matchAll(/https:\/\/tahoedogbeaches\.com\/wp-content\/uploads\/[^"\s)]+/g)].map((match) => match[0]);
check(imageUrls.length >= 10, "Expected the hero, gallery, and card photos.");
const uniqueUrls = [...new Set(imageUrls)];
const imageChecks = await Promise.all(uniqueUrls.map(async (url) => {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok ? null : `${response.status} ${url}`;
  } catch (error) {
    return `${error.message} ${url}`;
  }
}));
for (const imageFailure of imageChecks) {
  if (imageFailure) failures.push(imageFailure);
}

if (failures.length) {
  console.error("Production build failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), source);
writeFileSync(join(dist, "wordpress.html"), `<!-- wp:html -->\n${fragment}\n<!-- /wp:html -->\n`);

console.log(`Built ${uniqueUrls.length} photos, ${beachData.length} beaches.`);
console.log("dist/index.html");
console.log("dist/wordpress.html");
