/**
 * Builds the Chrome Web Store artifact: a zip of dist/ plus the LICENSE and
 * NOTICE attribution files, named by the manifest version. Portable across
 * the Windows dev machines and the Linux agents (no shell zip dependency).
 * Source maps and any test build never reach the artifact because dist/ is
 * produced fresh by tools/build.js and contains neither.
 */
import { copyFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import AdmZip from "adm-zip";

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf-8"));
const artifact = `build/lectern-${manifest.version}.zip`;

copyFileSync("LICENSE", "dist/LICENSE");
copyFileSync("NOTICE", "dist/NOTICE");

rmSync("build", { recursive: true, force: true });
mkdirSync("build", { recursive: true });

const zip = new AdmZip();
zip.addLocalFolder("dist", "", entry => !entry.endsWith(".map"));
zip.writeZip(artifact);

console.info(`${artifact} written`);
