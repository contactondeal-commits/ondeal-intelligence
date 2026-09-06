// ONDEAL AI CORE — PHASE 5 : "mammoth" n'expose aucun type bundlé et aucun
// paquet @types/mammoth n'existe — déclaration ambient MINIMALE, limitée à
// la seule fonction réellement appelée (attachments/parse.ts), jamais un
// "any" générique sur tout le module.
declare module "mammoth" {
  export interface ExtractRawTextResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(input: { buffer: Buffer } | { path: string }): Promise<ExtractRawTextResult>;
}
