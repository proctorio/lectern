/**
 * Serves the e2e fixture pages on a fixed local port. The Playwright config
 * starts and stops this process; it exists so the zero-egress test can
 * distinguish the one allowed origin from everything else.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const PORT = 8123;
const ROOT = "e2e/fixtures";

createServer(async(request, response) =>
{
	const path = normalize(join(ROOT, request.url === "/" ? "article.html" : request.url));
	if (!path.startsWith(normalize(ROOT)))
	{
		response.writeHead(403);
		response.end();

		return;
	}
	try
	{
		const body = await readFile(path);
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(body);
	}
	catch
	{
		response.writeHead(404);
		response.end("not found");
	}
}).listen(PORT, () => console.info(`fixture server on ${PORT}`));
