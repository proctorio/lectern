// Paragraph mapping shared by the popup display and its click-to-read
// targeting. A TTS chunk may contain several short paragraphs merged by the
// CharBreaker combine threshold in speech.js; this module splits a chunk's
// display text back into paragraphs, each carrying its character offset
// within the chunk, so a click can seek by (chunkIndex, offset).
//
// The separator regex must match the paragraph splitting inside speech.js
// (LatinPunctuator and EastAsianPunctuator getParagraphs) so that offsets
// computed here land on the same character positions the seek math sees.

export const paragraphSeparator = /((?:\r?\n\s*){2,})/;

// Splits a chunk's text into paragraph entries. Each entry keeps its
// trailing separator so concatenating entry texts reproduces the chunk
// exactly, and carries the offset of the paragraph start within the chunk.
export function splitChunkIntoParagraphs(chunkText)
{
	const tokens = chunkText.split(paragraphSeparator);
	const result = [];
	let offset = 0;

	// Split with a captured separator alternates [text, separator, text, ...];
	// the greedy separator regex guarantees empty text tokens only at the
	// very start or end, so every non-empty piece becomes one entry.
	for (let i = 0; i < tokens.length; i += 2)
	{
		const separator = (i + 1 < tokens.length) ? tokens[i + 1] : "";
		const piece = tokens[i] + separator;
		if (piece)
		{
			result.push({text: piece,
																offset: offset});
			offset += piece.length;
		}
	}

	return result;
}
