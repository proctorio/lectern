/**
 * Builds the distributable extension into dist/.
 *
 * The build is intentionally minimal so that shipped service worker and page
 * files are byte-identical to their sources under src/. Only content scripts
 * are bundled (they must run as classic scripts, so their ESM sources are
 * flattened to IIFE), and only when content entry points exist.
 */
import { cpSync, rmSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { buildSync } from "esbuild";

const CONTENT_ENTRIES = "src/js/content-entries";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("src", "dist", { recursive: true });

// The MIT attribution ships in every artifact. dist/ must be self-contained
// because the release flow zips it directly (the Plumbing version-pack
// pipeline), not only through tools/package.js.
copyFileSync("LICENSE", "dist/LICENSE");
copyFileSync("NOTICE", "dist/NOTICE");

if (existsSync(CONTENT_ENTRIES))
{
	rmSync("dist/js/content-entries", { recursive: true, force: true });
	buildSync({
		entryPoints: [`${CONTENT_ENTRIES}/*.js`],
		bundle: true,
		format: "iife",
		outdir: "dist/js/content-entries",
		legalComments: "inline",
		target: ["chrome99"]
	});
}

console.info("dist/ built");
