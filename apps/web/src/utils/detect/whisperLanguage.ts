/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Which language a piece of speech is in, as whisper itself works it out.
 *
 * transformers.js does not do this: asked for no language it logs "defaulting to English" and forces the
 * English token, so speech in any other language comes out as English words that sound like it - which is
 * how a Polish voice message became nonsense. Whisper's own method is one decoder step: after the
 * start-of-transcript token the model scores every language token, and the best one is the language.
 */

/** The parts of a transformers.js whisper pipeline this needs. */
export interface LanguageDetector {
    processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
    model: {
        (inputs: { input_features: unknown; decoder_input_ids: unknown }): Promise<{
            logits: { data: ArrayLike<number>; dims: number[]; type?: string };
        }>;
        generation_config: { decoder_start_token_id: number; lang_to_id?: Record<string, number> };
    };
    /** Builds the decoder's one-token prompt as the model's tensor type. */
    makePrompt: (token: number) => unknown;
}

/** A half-precision float's value, for logits a GPU hands back as raw 16-bit words. */
function halfToFloat(bits: number): number {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
    if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
    return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/**
 * The language code ("pl", "de", ...) whisper hears in the start of this audio, or undefined where the
 * model has no language tokens (an English-only model) or the scores are unusable.
 */
export async function detectLanguage(engine: LanguageDetector, samples: Float32Array): Promise<string | undefined> {
    const config = engine.model.generation_config;
    const languages = config.lang_to_id;
    if (!languages) return undefined;

    // The first half minute is all whisper looks at to decide, and all it can take at once.
    const { input_features } = await engine.processor(samples.subarray(0, 30 * 16_000));
    const { logits } = await engine.model({
        input_features,
        decoder_input_ids: engine.makePrompt(config.decoder_start_token_id),
    });

    const vocabulary = logits.dims[logits.dims.length - 1];
    const lastStep = logits.data.length - vocabulary;
    const half = logits.type === "float16";
    let best: string | undefined;
    let bestScore = -Infinity;
    for (const [token, id] of Object.entries(languages)) {
        const raw = logits.data[lastStep + id];
        const score = half ? halfToFloat(raw) : raw;
        if (score > bestScore) {
            bestScore = score;
            best = token.replace(/^<\||\|>$/g, "");
        }
    }
    return best;
}
