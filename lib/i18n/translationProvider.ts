/**
 * Translation provider abstraction.
 *
 * Currently a stub that returns null for all translations.
 * Replace with a real provider (e.g. DeepL, Google Translate) when ready.
 */
export interface TranslationProvider {
  translate(
    text: string,
    fromLocale: string,
    toLocale: string
  ): Promise<string | null>;
}

export class StubTranslationProvider implements TranslationProvider {
  async translate(): Promise<string | null> {
    return null;
  }
}

export const translationProvider: TranslationProvider =
  new StubTranslationProvider();
