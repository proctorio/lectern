import { getSettings, updateSettings, domReady, setI18nText } from "./defaults.js";

Promise.all([getSettings(), domReady()]).then(([settings]) =>
{
	setI18nText();

	const checkbox = document.getElementById("fix-bt-silence-gap");
	checkbox.checked = Boolean(settings.fixBtSilenceGap);
	checkbox.addEventListener("change", function()
	{
		updateSettings({fixBtSilenceGap: this.checked})
			.catch(console.error);
	});
});
