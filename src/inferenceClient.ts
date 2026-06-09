import { ZetaConfig } from './config';

interface CompletionResponse {
  choices: Array<{
    text: string;
    index: number;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class InferenceClient {
  private config: ZetaConfig;
  private abortController: AbortController | null = null;

  constructor(config: ZetaConfig) {
    this.config = config;
  }

  updateConfig(config: ZetaConfig) {
    this.config = config;
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async complete(
    prompt: string,
    maxTokens: number,
    stop: string[],
    signal?: AbortSignal
  ): Promise<string | null> {
    const controller = new AbortController();
    this.abortController = controller;

    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetch(
        `${this.config.serverUrl}/v1/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            max_tokens: maxTokens,
            temperature: this.config.temperature,
            stop,
            model: this.config.modelName,
          }),
          signal: combinedSignal,
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`Zeta server error ${response.status}: ${text}`);
        return null;
      }

      const data = (await response.json()) as CompletionResponse;
      const text = data.choices?.[0]?.text ?? null;
      return text ? text.trimEnd() : null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      console.error('Zeta inference error:', err);
      return null;
    } finally {
      this.abortController = null;
    }
  }
}
