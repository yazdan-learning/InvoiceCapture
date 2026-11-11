import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiModels, validChoices, type AiChoices, type AiModelsStore, type ProviderConfig } from '../src/ai/models/ai-models';
import { PdfChatOcr, imageAsPdf } from '../src/ai/gateway/lighton-ocr';
import { MistralOcr } from '../src/ai/gateway/mistral-ocr';
import { reasoningEffortFor } from '../src/ai/models/catalog';

const providers: ProviderConfig = {
  MISTRAL: { baseUrl: 'https://mistral.test/v1', apiKey: 'm' },
  GOOGLE: { baseUrl: 'https://google.test/v1', apiKey: '' },
  SCALEWAY: { baseUrl: 'https://scaleway.test/v1', apiKey: 's' }
};

function memoryStore(initial: AiChoices = {}): AiModelsStore & { saved: AiChoices } {
  const store = {
    saved: initial,
    load: async () => store.saved,
    save: vi.fn(async (choices: AiChoices) => {
      store.saved = choices;
    })
  };
  return store;
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization };
}

function answering(content: string) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
}

afterEach(() => vi.unstubAllGlobals());

describe('AI model settings', () => {
  it('keeps only choices the server can honour', () => {
    const choices = validChoices(
      {
        READING: { provider: 'SCALEWAY', model: ' qwen3.6-35b-a3b ' },
        VISION: { provider: 'GOOGLE', model: 'gemini-3.5-flash' }, // no Google key
        OCR: { provider: 'OFF' }, // OCR can't be switched off
        TEMPLATE: { provider: 'OFF' },
        LARGE: { provider: 'MISTRAL', model: '' },
        NOPE: { provider: 'MISTRAL', model: 'x' }
      },
      providers
    );
    expect(choices).toEqual({ READING: { provider: 'SCALEWAY', model: 'qwen3.6-35b-a3b' }, TEMPLATE: { provider: 'OFF' } });
  });

  it('refuses a provider that has no model for the use case (OCR on Google)', () => {
    expect(validChoices({ OCR: { provider: 'GOOGLE', model: 'gemini' } }, { ...providers, GOOGLE: { baseUrl: 'g', apiKey: 'g' } })).toEqual({});
  });

  it('calls the chosen provider and model, with thinking off for Qwen', async () => {
    const fetchMock = answering('{"ok":true}');
    vi.stubGlobal('fetch', fetchMock);
    const models = new AiModels(memoryStore({ VISION: { provider: 'SCALEWAY', model: 'qwen3.6-35b-a3b' } }), providers);
    await models.load();
    await models.vision()!.complete({ model: 'fast', system: 's', prompt: 'p', temperature: 0, maxTokens: 10 });
    const { url, body, auth } = lastRequest(fetchMock);
    expect(url).toBe('https://scaleway.test/v1/chat/completions');
    expect(auth).toBe('Bearer s');
    expect(body.model).toBe('qwen3.6-35b-a3b');
    expect(body.reasoning_effort).toBe('none');
  });

  it('switches on save and changes the version (readers are built again)', async () => {
    const store = memoryStore();
    const models = new AiModels(store, providers);
    const before = models.version;
    await models.save({ TEMPLATE: { provider: 'OFF' }, OCR: { provider: 'SCALEWAY', model: 'lightonocr-3-0.8b' } });
    expect(models.version).not.toBe(before);
    expect(store.save).toHaveBeenCalled();
    expect(models.template()).toBeNull();
    expect(models.ocr()).toBeInstanceOf(PdfChatOcr);
  });

  it('uses the .env setup without a choice, and when the chosen provider lost its key', async () => {
    const models = new AiModels(memoryStore({ OCR: { provider: 'SCALEWAY', model: 'lightonocr-3-0.8b' } }), { ...providers, SCALEWAY: { baseUrl: 's', apiKey: '' } });
    await models.load();
    expect(models.choice('OCR')).toBeUndefined();
    expect(models.ocr()).toBeInstanceOf(MistralOcr);
  });

  it('sends each model the reasoning setting it accepts', () => {
    expect(reasoningEffortFor('SCALEWAY', 'qwen3.5-397b-a17b', 'none')).toBe('none');
    expect(reasoningEffortFor('SCALEWAY', 'gpt-oss-120b', 'none')).toBe('low'); // "none" is refused
    expect(reasoningEffortFor('SCALEWAY', 'mistral-small-3.2-24b-instruct-2506', 'none')).toBeUndefined();
    expect(reasoningEffortFor('GOOGLE', 'gemini-3.5-flash', 'none')).toBe('none');
    expect(reasoningEffortFor('MISTRAL', 'mistral-medium-latest', 'none')).toBeUndefined();
  });
});

describe('LightOnOCR (PDF-only OCR model)', () => {
  it('sends a photo as a one-page PDF and returns the text', async () => {
    const fetchMock = answering('NOVA STEEL 81234');
    vi.stubGlobal('fetch', fetchMock);
    const photo = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#fff' } }).png().toBuffer();
    const text = await new PdfChatOcr({ baseUrl: 'https://scaleway.test/v1', apiKey: 's', model: 'lightonocr-3-0.8b', timeoutMs: 1000 }).extractText({ buffer: photo, filename: 'a.png', contentType: 'image/png' });
    expect(text).toBe('NOVA STEEL 81234');
    const part = lastRequest(fetchMock).body.messages[0].content[0];
    expect(part.type).toBe('file');
    expect(part.file.file_data.startsWith('data:application/pdf;base64,')).toBe(true);
  });

  it('builds a PDF whose cross-reference table points at its objects', async () => {
    const pdf = (await imageAsPdf(await sharp({ create: { width: 30, height: 20, channels: 4, background: '#f00' } }).png().toBuffer())).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 893 595]'); // paper-sized, same shape as the photo
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`));
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });
});
