declare module 'subsrt/lib/format/ssa.js' {
  export interface SsaCaption {
    readonly type: 'caption' | 'meta' | 'style';
    readonly start: number;
    readonly end: number;
    readonly duration: number;
    readonly content: string;
    readonly text: string;
    readonly data?: Record<string, string>;
  }

  export interface SsaFormat {
    readonly name: string;
    detect(content: string): string | null;
    parse(content: string, options: { eol?: string; verbose?: boolean }): SsaCaption[];
    build(captions: readonly SsaCaption[], options?: Record<string, unknown>): string;
  }

  const format: SsaFormat;
  export default format;
}
