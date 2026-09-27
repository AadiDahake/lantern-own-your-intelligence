/**
 * The provider module, against a stubbed SDK.
 *
 * Nothing here touches the network. The `openai` package is replaced at the module boundary, so
 * these tests assert the two things that are ours: the request shape each call sends, and the
 * coercion of whatever the model sends back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_DIMENSIONS, MODELS } from "@lantern/shared";

type Call = Record<string, unknown>;

const calls: { responses: Call[]; embeddings: Call[]; speech: Call[]; transcriptions: Call[] } = {
  responses: [],
  embeddings: [],
  speech: [],
  transcriptions: [],
};

/** What the next stubbed call answers with. Each test sets the one it needs. */
const next = {
  outputText: "",
  embeddings: [] as number[][],
  speechChunks: [] as Uint8Array[],
  transcriptionText: "",
  models: [{ id: MODELS.answer }] as unknown[],
};

vi.mock("openai", () => {
  class FakeOpenAI {
    responses = {
      create: async (body: Call) => {
        calls.responses.push(body);
        return { output_text: next.outputText };
      },
    };
    embeddings = {
      create: async (body: Call) => {
        calls.embeddings.push(body);
        return { data: next.embeddings.map((embedding) => ({ embedding })) };
      },
    };
    audio = {
      speech: {
        create: async (body: Call) => {
          calls.speech.push(body);
          const chunks = [...next.speechChunks];
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
              },
            }),
          };
        },
      },
      transcriptions: {
        create: async (body: Call) => {
          calls.transcriptions.push(body);
          return { text: next.transcriptionText };
        },
      },
    };
    models = { list: async () => ({ data: next.models }) };
  }
  return { default: FakeOpenAI };
});

const { chatJson, chatText, embed, listModels, ocr, resetClient, speakStream, transcribe } =
  await import("@/lib/openai");

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  calls.responses = [];
  calls.embeddings = [];
  calls.speech = [];
  calls.transcriptions = [];
  resetClient();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

const vector = (width: number): number[] => Array.from({ length: width }, () => 0.01);

describe("chat", () => {
  it("sends a strict json_schema format and parses what comes back", async () => {
    next.outputText = '{"feature":"dark mode"}';
    const schema = { type: "object", properties: { feature: { type: "string" } } };

    const result = await chatJson<{ feature: string }>(
      MODELS.understand,
      [{ role: "user", content: "how do I turn on dark mode?" }],
      schema,
      { name: "understanding", effort: "low", maxTokens: 2000 },
    );

    expect(result).toEqual({ feature: "dark mode" });
    const sent = calls.responses[0]!;
    expect(sent.model).toBe(MODELS.understand);
    expect(sent.text).toEqual({
      format: { type: "json_schema", name: "understanding", schema, strict: true },
    });
    expect(sent.reasoning).toEqual({ effort: "low" });
    expect(sent.max_output_tokens).toBe(2000);
  });

  it("leaves reasoning to the model when no effort is asked for", async () => {
    next.outputText = "plain";
    await chatText(MODELS.answer, [{ role: "user", content: "hello" }]);
    expect(calls.responses[0]).not.toHaveProperty("reasoning");
  });

  it("names the model when the output is not JSON", async () => {
    next.outputText = "I cannot do that";
    await expect(
      chatJson(MODELS.understand, [{ role: "user", content: "x" }], { type: "object" }),
    ).rejects.toThrow(new RegExp(MODELS.understand));
  });
});

describe("embeddings", () => {
  it("asks for the width the schema is built around and returns the vectors", async () => {
    next.embeddings = [vector(EMBED_DIMENSIONS), vector(EMBED_DIMENSIONS)];
    const vectors = await embed(["one", "two"]);

    expect(vectors).toHaveLength(2);
    expect(calls.embeddings[0]).toEqual({
      model: MODELS.embed,
      input: ["one", "two"],
      dimensions: EMBED_DIMENSIONS,
    });
  });

  it("calls nothing for an empty batch", async () => {
    expect(await embed([])).toEqual([]);
    expect(calls.embeddings).toHaveLength(0);
  });

  it("refuses a vector of the wrong width", async () => {
    next.embeddings = [vector(1024)];
    await expect(embed(["one"])).rejects.toThrow(/width 1024/);
  });
});

describe("document reading", () => {
  it("sends a PDF as a file and keeps the confidence of every page and block", async () => {
    next.outputText = JSON.stringify({
      pages: [
        {
          index: 0,
          markdown: "# Handbook",
          confidence: 0.92,
          blocks: [{ type: "title", content: "Handbook", confidence: 0.92 }],
        },
      ],
    });

    const result = await ocr("data:application/pdf;base64,JVBER");

    expect(result.pages[0]!.confidence).toBe(0.92);
    expect(result.pages[0]!.blocks[0]).toEqual({
      type: "title",
      content: "Handbook",
      confidence: 0.92,
    });
    const content = (calls.responses[0]!.input as { content: unknown }[])[1]!.content as Call[];
    expect(content[0]!.type).toBe("input_file");
    expect(content[0]!.file_data).toBe("data:application/pdf;base64,JVBER");
  });

  it("sends an image as an image", async () => {
    next.outputText = JSON.stringify({ pages: [] });
    await ocr("data:image/png;base64,iVBOR");
    const content = (calls.responses[0]!.input as { content: unknown }[])[1]!.content as Call[];
    expect(content[0]!.type).toBe("input_image");
    expect(content[0]!.image_url).toBe("data:image/png;base64,iVBOR");
  });

  it("clamps a confidence outside the range and drops one that is not a number", async () => {
    next.outputText = JSON.stringify({
      pages: [
        { index: 0, markdown: "a", confidence: 4, blocks: [] },
        { index: 1, markdown: "b", confidence: "high", blocks: [] },
      ],
    });

    const result = await ocr("data:image/png;base64,iVBOR");
    expect(result.pages[0]!.confidence).toBe(1);
    expect(result.pages[1]!.confidence).toBeNull();
  });

  it("survives a page with nothing on it", async () => {
    next.outputText = JSON.stringify({ pages: [{}] });
    const result = await ocr("data:image/png;base64,iVBOR");
    expect(result.pages[0]).toEqual({ index: 0, markdown: "", confidence: null, blocks: [] });
  });
});

describe("audio", () => {
  it("streams speech as mp3 chunks in order", async () => {
    next.speechChunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const chunks: number[] = [];
    for await (const chunk of speakStream("hello", "marin")) chunks.push(...chunk);

    expect(chunks).toEqual([1, 2, 3]);
    expect(calls.speech[0]).toMatchObject({
      model: MODELS.speak,
      input: "hello",
      voice: "marin",
      response_format: "mp3",
    });
  });

  it("transcribes with the current speech model", async () => {
    next.transcriptionText = "where do I change my seat";
    const text = await transcribe(new Blob([new Uint8Array([1])], { type: "audio/webm" }));

    expect(text).toBe("where do I change my seat");
    expect(calls.transcriptions[0]!.model).toBe(MODELS.transcribe);
  });
});

describe("health", () => {
  it("is live when the model list comes back", async () => {
    expect(await listModels()).toBe(true);
  });
});
