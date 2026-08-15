import { brapi } from "./brapi.js";
import * as rxjs from "./vendor/rxjs.js";
import { defaults, getQueryString, domReady, setI18nText, getHotkeySettingsUrl, updateSettings, updateSetting, clearSettings, observeSetting, settingsChange$, immediate, groupVoicesByLang, getVoiceLanguages, getFirstLanguage, isOfflineVoice, findVoiceByName, parseLang, formatError, bgPageInvoke, effectiveShowHighlighting } from "./defaults.js";
import { registerMessageListener } from "./messaging.js";
import { voices$ } from "./tts-engines.js";

(function() 
{
	const queryString = getQueryString();
	const domReadyPromise = domReady();
	const playerCheckIn$ = new rxjs.Subject();

	domReadyPromise.then(() => $("#about-version").text(brapi.runtime.getManifest().version));

	registerMessageListener("options", {
		playerCheckIn() 
		{
			playerCheckIn$.next();
		}
	});

	// i18n
	domReadyPromise
		.then(setI18nText);

	// close button
	domReadyPromise
		.then(() => 
		{
			if (queryString.referer) 
			{
				$("button.close").show()
					.click(function() 
					{
						history.back();
					});
			}
		});

	// hotkey
	domReadyPromise
		.then(() => 
		{
			$("#hotkeys-link")
				.click(function()
				{
					brapi.tabs.create({url: getHotkeySettingsUrl()});
				})
				.on("keydown", function(event)
				{
					// Links activate on Enter only; the click path is reused.
					if (event.key == "Enter") $(this).click();
				});
		});

	// voice
	domReadyPromise
		.then(() => 
		{
			$("#voices")
				.change(function() 
				{
					var voiceName = $(this).val();
					if (voiceName == "@languages") brapi.tabs.create({url: "languages.html"});
					else updateSettings({voiceName});
				});
			$("#languages-edit-button")
				.click(function() 
				{
					brapi.tabs.create({url: "languages.html"});
				});
		});

	const voicesPopulatedObservable = rxjs.combineLatest([
		voices$,
		observeSetting("languages"),
		brapi.i18n.getAcceptLanguages().catch(err => 
		{
			console.error(err); 

			return []; 
		}),
		domReadyPromise
	]).pipe(
		rxjs.tap(([voices, languages, acceptLangs]) => populateVoices(voices, {languages}, acceptLangs)),
		rxjs.share()
	);

	rxjs.combineLatest([observeSetting("voiceName"), voicesPopulatedObservable])
		.subscribe(([voiceName]) => 
		{
			$("#voices").val(voiceName || "");
		});

	// rate
	const rateSliderPromise = domReadyPromise
		.then(() => 
		{
			const slider = createSlider($("#rate").get(0), {
				onChange(value) 
				{
					const rate = Math.pow($("#rate").data("pow"), value);
					updateSetting("rate" + $("#voices").val(), Number(rate.toFixed(3)));
				},
				formatValue(value) 
				{
					return Math.pow($("#rate").data("pow"), value).toFixed(2) + "x";
				}
			});
			$("#rate-edit-button")
				.click(function() 
				{
					$("#rate, #rate-input-div").toggle();
				});
			$("#rate-input")
				.change(function() 
				{
					var val = $(this).val().trim();
					if (isNaN(val)) $(this).val(1);
					else if (val < 0.1) $(this).val(0.1);
					else if (val > 10) $(this).val(10);
					else $("#rate-edit-button").hide();
					updateSetting("rate" + $("#voices").val(), Number($(this).val()));
				});
			
			return slider;
		});

	const rateObservable = observeSetting("voiceName")
		.pipe(
			rxjs.switchMap(voiceName => observeSetting("rate" + (voiceName || ""))),
			rxjs.share()
		);

	rxjs.combineLatest([rateObservable, rateSliderPromise])
		.subscribe(([rate, slider]) => 
		{
			slider.setValue(Math.log(rate || defaults.rate) / Math.log($("#rate").data("pow")));
			$("#rate-input").val(rate || defaults.rate);
		});

	rxjs.combineLatest([observeSetting("voiceName"), rateObservable, domReadyPromise])
		.subscribe(([voiceName, rate]) => 
		{
			$("#rate-warning").toggle(rate > 2);
		});

	// pitch
	const pitchSliderPromise = domReadyPromise
		.then(() => 
			createSlider($("#pitch").get(0), {
				onChange(value) 
				{
					updateSettings({pitch: value});
				}
			}));

	rxjs.combineLatest([observeSetting("pitch"), pitchSliderPromise])
		.subscribe(([pitch, slider]) => slider.setValue(pitch || defaults.pitch));

	// volume
	const volumeSliderPromise = domReadyPromise
		.then(() => 
			createSlider($("#volume").get(0), {
				onChange(value) 
				{
					updateSettings({volume: value});
				}
			}));

	rxjs.combineLatest([observeSetting("volume"), volumeSliderPromise])
		.subscribe(([volume, slider]) => slider.setValue(volume || defaults.volume));

	// showHighlighting
	domReadyPromise
		.then(() =>
		{
			$("#show-highlighting")
				.change(function()
				{
					updateSettings({showHighlighting: $(this).val()});
				});
		});

	// The displayed value collapses the window choice to the popup while
	// exam-safe mode is on (milestone M5); the stored preference is kept.
	rxjs.combineLatest([observeSetting("showHighlighting"), observeSetting("examSafeMode"), domReadyPromise])
		.subscribe(([showHighlighting, examSafeMode]) => $("#show-highlighting").val(effectiveShowHighlighting(showHighlighting || defaults.showHighlighting, examSafeMode)));

	// exam-safe mode (milestone M5): reads the active tab only, never opens
	// windows, and keeps overlay announcements on.
	domReadyPromise
		.then(() =>
		{
			$("#exam-safe-mode")
				.change(function()
				{
					updateSettings({examSafeMode: this.checked});
				});
		});

	rxjs.combineLatest([observeSetting("examSafeMode"), domReadyPromise])
		.subscribe(([examSafeMode]) =>
		{
			$("#exam-safe-mode").prop("checked", Boolean(examSafeMode));

			// The window highlighting surface opens a popout window, which
			// exam-safe mode forbids; hide the choice while the mode is on.
			$("#show-highlighting option[value='2']")
				.prop("disabled", Boolean(examSafeMode))
				.toggle(!examSafeMode);
		});

	// voiceTest
	const demoSpeech = {
		get(lang) 
		{
			return Promise.resolve({text: "This is a sample of the selected voice reading aloud."});
		}
	};
	const voiceTestSubject = new rxjs.Subject();
	rxjs.defer(() => domReadyPromise).pipe(rxjs.exhaustMap(() =>
		voiceTestSubject.pipe(
			rxjs.switchScan(
				({state}) =>
					rxjs.iif(
						() => state == "STOPPED",

						// play
						rxjs.defer(() => 
							voices$.pipe(rxjs.take(1))).pipe(
							rxjs.exhaustMap(voices => 
							{
								const voiceName = $("#voices").val();
								const voice = voiceName && findVoiceByName(voices, voiceName);
								const {lang} = parseLang(voice && getFirstLanguage(voice) || "en-US");
								
								return rxjs.defer(() => demoSpeech.get(lang)).pipe(rxjs.exhaustMap(({text}) => bgPageInvoke("playText", [text, {lang}])));
							}),
							rxjs.exhaustMap(() =>
								rxjs.timer(100, 500).pipe(
									rxjs.exhaustMap(() => bgPageInvoke("getPlaybackState")),
									rxjs.takeWhile(({state}) => state != "STOPPED", true)
								))
						),

						// stop
						rxjs.defer(() => bgPageInvoke("stop")).pipe(rxjs.map(() => ({state: "STOPPED"})))
					),
				{state: "STOPPED"}
			),
			rxjs.startWith({state: "STOPPED"})
		))).subscribe({
		next({state, playbackError}) 
		{
			$("#test-voice .spinner").toggle(state == "LOADING");
			$("#test-voice [data-i18n]").text(brapi.i18n.getMessage(state == "STOPPED" ? "options_test_button" : "options_stop_button"));
			if (state == "STOPPED" && playbackError) handleError(playbackError);
			else $("#status").parent().hide();
		},
		error: handleError
	});

	// buttons
	domReadyPromise
		.then(() => 
		{
			$("#test-voice").click(() => voiceTestSubject.next());
			$("#reset")
				.click(function() 
				{
					clearSettings();
				});
		});

	// status
	domReadyPromise
		.then(() => 
		{
			$("#status").parent().hide();
		});

	settingsChange$
		.subscribe(() => 
		{
			showConfirmation();
			bgPageInvoke("stop").catch(err => "OK");
		});

	function populateVoices(allVoices, settings, acceptLangs) 
	{
		$("#voices").empty();
		$("<option>")
			.val("")
			.text("Auto select")
			.appendTo("#voices");

		// get voices filtered by selected languages
		var selectedLangs = immediate(() => 
		{
			if (settings.languages) return settings.languages.split(",");
			if (settings.languages == "") return null;
			const accept = new Set(acceptLangs.map(x => x.split("-", 1)[0]));
			const langs = Object.keys(groupVoicesByLang(allVoices)).filter(x => accept.has(x));
			
			return langs.length ? langs : null;
		});
		var voices = !selectedLangs ? allVoices : allVoices.filter(function(voice) 
		{
			const voiceLanguages = getVoiceLanguages(voice);
			
			return !voiceLanguages ||
          voiceLanguages.map(parseLang).some(({ lang }) => selectedLangs.includes(lang));
		});

		// group by offline/standard
		var groups = Object.assign(
			{
				offline: [],
				standard: []
			},
			voices.groupBy(function(voice) 
			{
				if (isOfflineVoice(voice)) return "offline";
				
				return "standard";
			})
		);
		for (var name in groups) groups[name].sort(voiceSorter);

		// create the offline optgroup
		const offline = $("<optgroup>")
			.attr("label", brapi.i18n.getMessage("options_voicegroup_offline"))
			.appendTo($("#voices"));
		for (const voice of groups.offline) 
		{
			$("<option>")
				.val(voice.voiceName)
				.text(voice.voiceName)
				.appendTo(offline);
		}

		// create the standard optgroup
		$("<optgroup>").appendTo($("#voices"));
		var standard = $("<optgroup>")
			.attr("label", brapi.i18n.getMessage("options_voicegroup_standard"))
			.appendTo($("#voices"));
		groups.standard.forEach(function(voice) 
		{
			$("<option>")
				.val(voice.voiceName)
				.text(voice.voiceName)
				.appendTo(standard);
		});

		// create the additional optgroup
		$("<optgroup>").appendTo($("#voices"));
		var additional = $("<optgroup>")
			.attr("label", brapi.i18n.getMessage("options_voicegroup_additional"))
			.appendTo($("#voices"));
		$("<option>")
			.val("@languages")
			.text(brapi.i18n.getMessage("options_add_more_languages"))
			.appendTo(additional);
	}

	function voiceSorter(a, b) 
	{
		return a.voiceName.localeCompare(b.voiceName);
	}

	function showConfirmation() 
	{
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
		{
			$(".green-check").finish().show();
			setTimeout(function() { $(".green-check").hide(); }, 1000);
		}
		else
		{
			$(".green-check").finish().show().delay(500).fadeOut();
		}
	}

	function handleError(err) 
	{
		if ((/^{/).test(err.message)) 
		{
			var errInfo = JSON.parse(err.message);
			$("#status").html(formatError(errInfo)).parent().show();
		}
		else 
		{
			$("#status").text(err.message).parent().show();
		}
	}

	function createSlider(elem, {onChange, onSlideChange, formatValue}) 
	{
		// A native range input provides the slider role, keyboard operation,
		// and forced-colors rendering for free. Positions are integer steps;
		// aria-valuetext carries the effective value so assistive tech never
		// hears the raw step number.
		var min = $(elem).data("min") || 0;
		var max = $(elem).data("max") || 1;
		var steps = $(elem).data("steps") || 20;
		var format = formatValue || function(value) { return String(Math.round(value * 100) / 100); };
		var $input = $("<input type='range'>")
			.attr({min: 0,
										max: steps,
										step: 1});
		var labelId = $(elem).data("label");
		if (labelId) $input.attr("aria-labelledby", labelId);
		$(elem).empty().toggleClass("slider", true).append($input);

		$input.on("input", function() 
		{
			var value = toValue(Number(this.value));
			$input.attr("aria-valuetext", format(value));
			if (onSlideChange) onSlideChange(value);
		});
		$input.on("change", function() 
		{
			var value = toValue(Number(this.value));
			$input.attr("aria-valuetext", format(value));
			onChange(value);
		});

		return {
			setValue(value) 
			{
				var position = Math.round((Math.min(value, max) - min) / (max - min) * steps);
				$input.val(position).attr("aria-valuetext", format(toValue(position)));
			}
		};

		function toValue(position) 
		{
			return min + (position / steps) * (max - min);
		}
	}

})();
