/**
 * @description Deterministic fakes for the Web Speech API and Audio, which jsdom does not
 * implement. Utterance events fire on microtasks so tests stay synchronous
 * friendly under fake timers.
 */

/**
 * @description Fake SpeechSynthesisUtterance capturing constructor input.
 */
export class FakeUtterance
{
	/**
	 * @description Creates an utterance.
	 *
	 * @param {string} text - The utterance text.
	 */
	constructor(text)
	{
		Object.assign(this, {
			text,
			onstart: null,
			onend: null,
			onerror: null
		});
	}
}

/**
 * @description Creates a fake speechSynthesis whose spoken utterances complete on
 * microtasks unless paused.
 *
 * @return {Object} - The speechSynthesis fake.
 */
export function makeSpeechSynthesis()
{
	const state = { queue: [],
																	paused: false,
																	speaking: false,
																	voices: [],
																	canceled: false };

	return {
		__state: state,

		/**
		 * @description Mirrors the real speaking property from fake state.
		 *
		 * @return {boolean} - Whether speech is active.
		 */
		get speaking()
		{
			return state.speaking;
		},

		/**
		 * @description Queues an utterance and fires its lifecycle events.
		 *
		 * @param {FakeUtterance} utterance - The utterance to speak.
		 */
		speak(utterance)
		{
			state.canceled = false;
			state.queue.push(utterance);
			queueMicrotask(() =>
			{
				if (state.canceled) return;
				if (utterance.onstart) utterance.onstart();
				queueMicrotask(() =>
				{
					if (state.canceled || state.paused) return;
					if (utterance.onend) utterance.onend();
				});
			});
		},

		/**
		 * @description Cancels all speech.
		 */
		cancel()
		{
			state.canceled = true;
			state.queue = [];
		},

		/**
		 * @description Pauses speech.
		 */
		pause()
		{
			state.paused = true;
		},

		/**
		 * @description Resumes speech.
		 */
		resume()
		{
			state.paused = false;
		},

		/**
		 * @description Returns the configured voices.
		 *
		 * @return {Array<Object>} - Voice fixtures.
		 */
		getVoices()
		{
			return state.voices;
		},

		onvoiceschanged: null
	};
}

/**
 * @description Fake Audio element recording playback calls.
 */
export class FakeAudio
{
	/**
	 * @description Creates a fake audio element.
	 *
	 * @param {string} [src] - Optional source URL.
	 */
	constructor(src)
	{
		this.src = src;
		this.played = 0;
		this.paused = true;
		this.loop = false;
		this.volume = 1;
		this.defaultPlaybackRate = 1;
	}

	/**
	 * @description Records a play call.
	 *
	 * @return {Promise<void>} - Resolves immediately.
	 */
	play()
	{
		this.played++;
		this.paused = false;

		return Promise.resolve();
	}

	/**
	 * @description Records a pause call.
	 */
	pause()
	{
		this.paused = true;
	}
}
