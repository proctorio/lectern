var lecternDoc = new function() 
{
	var self = this;

	this.ignoreTags = "select, textarea, button, label, audio, video, dialog, embed, menu, nav, noframes, noscript, object, script, style, svg, aside, footer, #footer, .no-lectern, [aria-hidden=true]";

	this.getCurrentIndex = function() 
	{
		return 0;
	};

	this.getTexts = async function(index) 
	{
		if (index == 0) 
		{
			const math = await getMath();
			try 
			{
				if (math) math.show();
				
				return parse();
			}
			finally 
			{
				if (math) math.hide();
			}
		}
		else return null;
	};

	this.getSelectedText = async function() 
	{
		const math = await getMath();
		try 
		{
			if (math) math.show();
			
			return window.getSelection().toString().trim();
		}
		finally 
		{
			if (math) math.hide();
		}
	};

	function parse() 
	{
		// find blocks containing text
		var start = new Date();
		var textBlocks = findTextBlocks(50);
		var countChars = textBlocks.reduce(function(sum, elem) { return sum + getInnerText(elem).length; }, 0);
		console.log("Found", textBlocks.length, "blocks", countChars, "chars in", new Date() - start, "ms");

		if (countChars < 1000) 
		{
			textBlocks = findTextBlocks(3);
			var texts = textBlocks.map(getInnerText);
			console.log("Using lower threshold, found", textBlocks.length, "blocks", texts.join("").length, "chars");

			// trim the head and the tail
			var head, tail;
			for (var i = 3; i < texts.length && !head; i++) 
			{
				var dist = getGaussian(texts, 0, i);
				if (texts[i].length > dist.mean + 2 * dist.stdev) head = i;
			}
			for (var i = texts.length - 4; i >= 0 && !tail; i--) 
			{
				var dist = getGaussian(texts, i + 1, texts.length);
				if (texts[i].length > dist.mean + 2 * dist.stdev) tail = i + 1;
			}
			if (head || tail) 
			{
				textBlocks = textBlocks.slice(head || 0, tail);
				console.log("Trimmed", head, tail);
			}
		}

		// collect the elements to be read. No marker class is added: extraction
		// must leave the page DOM exactly as it found it (docs/lectern/04).
		var toRead = [];
		for (var i = 0; i < textBlocks.length; i++)
		{
			toRead.push.apply(toRead, findHeadingsFor(textBlocks[i], textBlocks[i - 1]));
			toRead.push(textBlocks[i]);
		}

		// extract texts
		return toRead.flatMap(getTexts).filter(isNotEmpty);
	}

	function findTextBlocks(threshold) 
	{
		var skipTags = "h1, h2, h3, h4, h5, h6, p, a[href], " + self.ignoreTags;
		var isTextNode = function(node) 
		{
			return node.nodeType == 3 && node.nodeValue.trim().length >= 3;
		};
		var isParagraph = function(node) 
		{
			return node.nodeType == 1 && $(node).is("p:visible") && getInnerText(node).length >= threshold;
		};
		var hasTextNodes = function(elem) 
		{
			return someChildNodes(elem, isTextNode) && getInnerText(elem).length >= threshold;
		};
		var hasParagraphs = function(elem) 
		{
			return someChildNodes(elem, isParagraph);
		};
		var containsTextBlocks = function(elem) 
		{
			var childElems = $(elem).children(":not(" + skipTags + ")").get();
			
			return childElems.some(hasTextNodes) || childElems.some(hasParagraphs) || childElems.some(containsTextBlocks);
		};
		var addBlock = function(elem, multi) 
		{
			if (multi) $(elem).data("lectern-multi-block", true);
			textBlocks.push(elem);
		};
		var walk = function() 
		{
			if ($(this).is("frame, iframe")) try { walk.call(this.contentDocument.body); }
			catch (err) {}
			else if ($(this).is("dl")) addBlock(this);
			else if ($(this).is("ol, ul")) 
			{
				var items = $(this).children().get();
				if (items.some(hasTextNodes)) addBlock(this);
				else if (items.some(hasParagraphs)) addBlock(this, true);
				else if (items.some(containsTextBlocks)) addBlock(this, true);
			}
			else if ($(this).is("tbody")) 
			{
				var rows = $(this).children();
				if (rows.length > 3 || rows.eq(0).children().length > 3) 
				{
					if (rows.get().some(containsTextBlocks)) addBlock(this, true);
				}
				else rows.each(walk);
			}
			else 
			{
				if (hasTextNodes(this)) addBlock(this);
				else if (hasParagraphs(this)) addBlock(this, true);
				else $(this).add(this.shadowRoot).children(":not(" + skipTags + ")").each(walk);
			}
		};
		var textBlocks = [];
		walk.call(document.body);
		
		return textBlocks.filter(function(elem) 
		{
			return $(elem).is(":visible") && $(elem).offset().left >= 0;
		});
	}

	function getGaussian(texts, start, end) 
	{
		if (start == undefined) start = 0;
		if (end == undefined) end = texts.length;
		var sum = 0;
		for (var i = start; i < end; i++) sum += texts[i].length;
		var mean = sum / (end - start);
		var variance = 0;
		for (var i = start; i < end; i++) variance += (texts[i].length - mean) * (texts[i].length - mean);
		
		return {mean: mean,
										stdev: Math.sqrt(variance)};
	}

	function getTexts(elem)
	{
		// Every temporary mutation must be reverted even when extraction throws
		// mid-block: leaked surrogate spans or still-hidden answer labels would
		// permanently alter visible exam content.
		var toHide = $(elem).find(":visible").filter(dontRead).hide();
		try
		{
			$(elem).find("ol, ul").addBack("ol, ul").each(addNumbering);
			$(elem).find("fieldset").addBack("fieldset").each(addChoiceNumbering);
			$(elem).find("img[alt]").filter(":visible").each(addAltText);

			return $(elem).data("lectern-multi-block")
				? $(elem).children(":visible").get().map(getText)
				: getText(elem).split(paragraphSplitter);
		}
		finally
		{
			$(elem).find(".lectern-numbering, .lectern-alt").remove();
			toHide.show();
		}
	}

	// innerText never contains image alt text. Mirroring the math surrogate
	// pattern, a temporary span carries the alt text at the image's position
	// while the block is read, then is removed in the same cleanup pass.
	function addAltText()
	{
		var alt = ($(this).attr("alt") || "").trim();
		if (alt) $("<span>").addClass("lectern-alt").text(" " + alt + " ").insertAfter(this);
	}

	function addNumbering() 
	{
		var children = $(this).children();
		var text = children.length ? getInnerText(children.get(0)) : null;
		if (text && !text.match(/^\(?(\d|[A-Za-z][).])/))
			children.each(function(index) 
			{
				$("<span>").addClass("lectern-numbering").text((index + 1) + ". ").prependTo(this);
			});
	}

	function addChoiceNumbering()
	{
		if (!isChoiceFieldset(this)) return;
		$(this).find("label")
			.filter(function()
			{
				// nested choice fieldsets: a label already numbered by an outer
				// fieldset pass is skipped, so numbering never double-applies
				return isChoiceLabel(this) && $(this).is(":visible") &&
					!$(this).children(".lectern-numbering").length;
			})
			.each(function(index)
			{
				$("<span>").addClass("lectern-numbering").text((index + 1) + ". ").prependTo(this);
			});
	}

	function dontRead()
	{
		var float = $(this).css("float");
		var position = $(this).css("position");

		// Labels that carry radio or checkbox choice text are read; the bare
		// "label" entry in ignoreTags only hides plain form labels.
		var ignoreTags = isChoiceLabel(this) ? getIgnoreTagsWithoutLabel() : self.ignoreTags;

		return $(this).is(ignoreTags) || isHiddenChoiceLegend(this) || $(this).is("sup") || float == "right" || position == "fixed";
	}

	var ignoreTagsWithoutLabel = {source: null,
																															value: null};

	function getIgnoreTagsWithoutLabel()
	{
		if (ignoreTagsWithoutLabel.source != self.ignoreTags)
		{
			ignoreTagsWithoutLabel.source = self.ignoreTags;
			ignoreTagsWithoutLabel.value = self.ignoreTags.split(",")
				.map(function(item)
				{
					return item.trim();
				})
				.filter(function(item)
				{
					return item != "label";
				})
				.join(", ");
		}

		return ignoreTagsWithoutLabel.value;
	}

	function isChoiceLabel(elem)
	{
		if (!$(elem).is("label")) return false;
		if ($(elem).find("input[type=radio], input[type=checkbox]").length) return true;
		var forId = $(elem).attr("for");
		if (!forId) return false;
		var bound = elem.ownerDocument && elem.ownerDocument.getElementById(forId);

		return Boolean(bound) && $(bound).is("input[type=radio], input[type=checkbox]");
	}

	function isChoiceFieldset(elem)
	{
		return $(elem).is("fieldset") && $(elem).find("input[type=radio], input[type=checkbox]").length > 0;
	}

	// Screen-reader-only legends inside a choice fieldset (the clip or offscreen
	// absolute positioning patterns) duplicate what the numbered choices already
	// convey, so they are excluded from the read text.
	function isHiddenChoiceLegend(elem)
	{
		if (!$(elem).is("legend")) return false;
		if (!isChoiceFieldset($(elem).closest("fieldset").get(0))) return false;

		return isScreenReaderOnly(elem);
	}

	function isScreenReaderOnly(elem)
	{
		var position = $(elem).css("position");
		if (position != "absolute" && position != "fixed") return false;
		var clip = $(elem).css("clip");
		if (clip && clip != "auto") return true;
		var clipPath = $(elem).css("clip-path");
		if (clipPath && clipPath != "none") return true;

		return elem.offsetWidth <= 1 && elem.offsetHeight <= 1;
	}

	function getText(elem) 
	{
		return addMissingPunctuation(elem.innerText).trim();
	}

	function addMissingPunctuation(text) 
	{
		return text.replaceAll(/(\w)(\s*?\r?\n)/g, "$1.$2");
	}

	function findHeadingsFor(block, prevBlock) 
	{
		var result = [];
		var firstInnerElem = $(block).find("h1, h2, h3, h4, h5, h6, p").filter(":visible").get(0);
		var currentLevel = getHeadingLevel(firstInnerElem);
		var node = previousNode(block, true);
		while (node && node != prevBlock) 
		{
			var ignore = $(node).is(self.ignoreTags);
			if (!ignore && node.nodeType == 1 && $(node).is(":visible")) 
			{
				var level = getHeadingLevel(node);
				if (level < currentLevel) 
				{
					result.push(node);
					currentLevel = level;
				}
			}
			node = previousNode(node, ignore);
		}
		
		return result.reverse();
	}

	function getHeadingLevel(elem) 
	{
		var matches = elem && (/^h(\d)$/i).exec(elem.tagName);
		
		return matches ? Number(matches[1]) : 100;
	}

	function previousNode(node, skipChildren) 
	{
		if ($(node).is("body")) return null;
		if (node.nodeType == 1 && !skipChildren && node.lastChild) return node.lastChild;
		if (node.previousSibling) return node.previousSibling;
		if (node.parentNode) return previousNode(node.parentNode, true);
		
		return null;
	}

	function someChildNodes(elem, test) 
	{
		var child = elem.firstChild;
		while (child) 
		{
			if (test(child)) return true;
			child = child.nextSibling;
		}
		
		return false;
	}
};
