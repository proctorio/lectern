import { getSettings, updateSettings, domReady, setI18nText } from "./defaults.js";

Promise.all([getSettings(), domReady()]).then(([settings]) => 
{
	setI18nText();

	$("#fix-bt-silence-gap")
		.prop("checked", settings.fixBtSilenceGap)
		.change(function() 
		{
			updateSettings({fixBtSilenceGap: this.checked})
				.catch(console.error);
		});
});
