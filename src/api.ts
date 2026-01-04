import { ExtractResponse } from './types';

type ExtractParams = {
  file: File;
  apiBaseUrl?: string;
  useOcrFirst?: boolean;
};

const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5678';

export async function extractInvoice({
  file,
  apiBaseUrl = defaultBaseUrl,
  useOcrFirst = true
}: ExtractParams): Promise<ExtractResponse> {
  // Point to the test webhook path for the Mistral OCR flow
  const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/webhook/invoice-ocr-mistral`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('useOcrFirst', String(useOcrFirst));

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const json = (await response.json()) as ExtractResponse;
  return json;
}


