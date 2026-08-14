/**
 * Regenerates the committed vendor bundles under src/js/vendor/ from the
 * exact-pinned npm dependencies. Vendor bundles are checked in so the source
 * tree stays loadable and reviewable; rerun after bumping the pinned version
 * and commit the result. CI can rerun this script and diff to prove the
 * committed bundle matches the lockfile.
 */
import { buildSync } from "esbuild";

buildSync({
	entryPoints: ["rxjs"],
	bundle: true,
	format: "esm",
	outfile: "src/js/vendor/rxjs.js",
	legalComments: "inline",
	target: ["chrome99"]
});

console.info("src/js/vendor/ regenerated");
