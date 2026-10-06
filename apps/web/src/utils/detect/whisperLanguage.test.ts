/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { detectLanguage, type LanguageDetector } from "./whisperLanguage";

const LANGUAGES = { "<|en|>": 2, "<|pl|>": 3, "<|de|>": 4 };

/** An engine whose one decoder step scores the vocabulary (5 tokens, ids 2-4 are languages) as given. */
function engineScoring(scores: ArrayLike<number>, type = "float32"): LanguageDetector {
    const model = Object.assign(vi.fn().mockResolvedValue({ logits: { data: scores, dims: [1, 1, 5], type } }), {
        generation_config: { decoder_start_token_id: 1, lang_to_id: LANGUAGES },
    });
    return {
        processor: vi.fn().mockResolvedValue({ input_features: "features" }),
        model,
        makePrompt: (token) => ({ prompt: token }),
    };
}

describe("detectLanguage", () => {
    it("picks the language token the model scores highest", async () => {
        const engine = engineScoring([9, 9, 0.1, 2.5, 1.2]);
        expect(await detectLanguage(engine, new Float32Array(16))).toBe("pl");
        expect(engine.model).toHaveBeenCalledWith({ input_features: "features", decoder_input_ids: { prompt: 1 } });
    });

    it("ignores tokens that are not languages, however high they score", async () => {
        expect(await detectLanguage(engineScoring([50, 50, -1, -2, -0.5]), new Float32Array(16))).toBe("de");
    });

    it("reads scores a GPU returns as raw half floats", async () => {
        // 1.0 is 0x3c00, -2.0 is 0xc000, 3.0 is 0x4200: as unsigned words the negative one would win.
        const engine = engineScoring(Uint16Array.of(0, 0, 0x3c00, 0xc000, 0x4200), "float16");
        expect(await detectLanguage(engine, new Float32Array(16))).toBe("de");
    });

    it("only listens to the first half minute", async () => {
        const engine = engineScoring([0, 0, 1, 0, 0]);
        await detectLanguage(engine, new Float32Array(16_000 * 90));
        expect((engine.processor as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(16_000 * 30);
    });

    it("says nothing for a model without language tokens", async () => {
        const engine = engineScoring([1, 2, 3, 4, 5]);
        engine.model.generation_config.lang_to_id = undefined;
        expect(await detectLanguage(engine, new Float32Array(16))).toBeUndefined();
    });
});
