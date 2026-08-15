/**
 * @description Tests for paragraphs.js: the chunk-to-paragraph mapping the
 * popup uses to render one clickable span per paragraph with a (chunkIndex,
 * offset) seek target.
 */
import { splitChunkIntoParagraphs } from "../src/js/paragraphs.js";

describe("splitChunkIntoParagraphs", () =>
{
	it("returns a single entry at offset zero for a one-paragraph chunk", () =>
	{
		const entries = splitChunkIntoParagraphs("Just one paragraph.");

		expect(entries).toEqual([{ text: "Just one paragraph.",
																													offset: 0 }]);
	});

	it("splits a merged chunk into entries with correct offsets", () =>
	{
		const chunk = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
		const entries = splitChunkIntoParagraphs(chunk);

		expect(entries).toHaveLength(3);
		expect(entries[0].offset).toBe(0);
		expect(entries[1].offset).toBe(chunk.indexOf("Second"));
		expect(entries[2].offset).toBe(chunk.indexOf("Third"));
		expect(entries[1].text.startsWith("Second paragraph.")).toBe(true);
	});

	it("keeps separators so concatenating entries reproduces the chunk", () =>
	{
		const chunk = "Alpha one.\r\n\r\nBeta two.\n\n  \nGamma three.\n\n";
		const entries = splitChunkIntoParagraphs(chunk);

		expect(entries.map(entry => entry.text).join("")).toBe(chunk);
		for (const entry of entries)
		{
			expect(chunk.slice(entry.offset, entry.offset + entry.text.length)).toBe(entry.text);
		}
	});

	it("does not split on single newlines", () =>
	{
		const entries = splitChunkIntoParagraphs("Line one.\nLine two.");

		expect(entries).toHaveLength(1);
		expect(entries[0].text).toBe("Line one.\nLine two.");
	});

	it("keeps a leading separator as its own entry at offset zero", () =>
	{
		const chunk = "\n\nStarts after whitespace.";
		const entries = splitChunkIntoParagraphs(chunk);

		expect(entries[0]).toEqual({ text: "\n\n",
																															offset: 0 });
		expect(entries[1]).toEqual({ text: "Starts after whitespace.",
																															offset: 2 });
	});

	it("returns no entries for an empty chunk", () =>
	{
		expect(splitChunkIntoParagraphs("")).toEqual([]);
	});
});
