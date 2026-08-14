/**
 * Shared launch helper for the extension integration tests. Loads the built
 * extension from dist/ into a persistent Chromium context and resolves the
 * assigned extension id from the service worker URL.
 */
import { fileURLToPath } from "node:url";
import { cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const E2E_DIST = fileURLToPath(new URL("../.test_output/e2e-dist", import.meta.url));

/**
 * @description Builds the test copy of the extension. It is byte-identical to
 * dist/ except for ONE addition: a host permission for the local fixture
 * origin. In real use, activeTab grants page access on the user's toolbar
 * click or keyboard shortcut; Playwright cannot synthesize a browser-level
 * user gesture, so the fixture origin stands in for that grant. Nothing else
 * differs, and the zero-egress assertions run against this build unchanged.
 */
function buildTestExtension()
{
	rmSync(E2E_DIST, { recursive: true,
																				force: true });
	cpSync(DIST, E2E_DIST, { recursive: true });
	const manifestPath = `${E2E_DIST}/manifest.json`;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	manifest.host_permissions = ["http://localhost:8123/*"];
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * @description Launches Chromium with the built extension loaded and waits
 * for its service worker.
 *
 * @return {Promise<Object>} - The context, extension id, and service worker.
 */
export async function launchWithExtension()
{
	buildTestExtension();
	const context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		args: [
			`--disable-extensions-except=${E2E_DIST}`,
			`--load-extension=${E2E_DIST}`
		]
	});
	const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
	const extensionId = new URL(worker.url()).host;

	return { context,
										extensionId,
										worker };
}
