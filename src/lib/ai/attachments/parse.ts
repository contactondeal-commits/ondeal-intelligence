import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";

/**
 * ONDEAL AI CORE — PHASE 5 : File Intelligence — extraction RÉELLE (06/09/2026).
 *
 * §"File Intelligence" : "selon les parsers RÉELLEMENT supportés" — ce
 * fichier liste EXACTEMENT les formats pour lesquels une bibliothèque
 * réelle est installée (package.json) et appelée ci-dessous. Un format
 * absent de PARSER_SUPPORT retourne "UNSUPPORTED" (jamais un texte vide
 * présenté comme une extraction réussie).
 *
 * Taille de texte extrait bornée (MAX_EXTRACTED_CHARS) — un attachement de
 * plusieurs Mo ne doit jamais faire exploser le contexte modèle envoyé au
 * planner (graphRunner.ts::planInitialGraph) ; le texte est tronqué avec un
 * indicateur explicite, jamais silencieusement coupé sans le dire.
 */

export const PARSER_SUPPORT = ["PDF", "DOCX", "XLSX", "CSV", "JSON", "TXT", "MD"] as const;
export type ParsedKind = (typeof PARSER_SUPPORT)[number] | "CODE" | "IMAGE" | "UNKNOWN";

const MAX_EXTRACTED_CHARS = 20_000;

export interface ParseResult {
  status: "PARSED" | "FAILED" | "UNSUPPORTED";
  extractedText: string | null;
  error: string | null;
}

function truncate(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[...TRONQUÉ — ${text.length - MAX_EXTRACTED_CHARS} caractères supplémentaires non inclus...]`;
}

/** Dérive un `kind` RÉEL depuis le mimeType/nom de fichier — jamais une supposition sur le contenu binaire lui-même. */
export function classifyAttachment(filename: string, mimeType: string): ParsedKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "application/pdf" || ext === "pdf") return "PDF";
  if (mimeType.includes("wordprocessingml") || ext === "docx") return "DOCX";
  if (mimeType.includes("spreadsheetml") || ["xlsx", "xls"].includes(ext)) return "XLSX";
  if (mimeType === "text/csv" || ext === "csv") return "CSV";
  if (mimeType === "application/json" || ext === "json") return "JSON";
  if (mimeType === "text/markdown" || ext === "md") return "MD";
  if (mimeType.startsWith("text/") || ["txt"].includes(ext)) return "TXT";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "php", "css", "html", "sql"].includes(ext)) return "CODE";
  if (mimeType.startsWith("image/")) return "IMAGE";
  return "UNKNOWN";
}

/**
 * Extraction RÉELLE — jamais un texte fabriqué en cas d'échec (`status:
 * "FAILED"` explicite avec l'erreur réelle, jamais une chaîne vide
 * présentée comme un succès).
 */
export async function parseAttachment(kind: ParsedKind, buffer: Buffer): Promise<ParseResult> {
  try {
    switch (kind) {
      case "PDF": {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          return { status: "PARSED", extractedText: truncate(result.text), error: null };
        } finally {
          await parser.destroy();
        }
      }
      case "DOCX": {
        const result = await mammoth.extractRawText({ buffer });
        return { status: "PARSED", extractedText: truncate(result.value), error: null };
      }
      case "XLSX": {
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const parts = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
          return `# Feuille : ${name}\n${csv}`;
        });
        return { status: "PARSED", extractedText: truncate(parts.join("\n\n")), error: null };
      }
      case "CSV":
      case "JSON":
      case "TXT":
      case "MD":
      case "CODE": {
        return { status: "PARSED", extractedText: truncate(buffer.toString("utf-8")), error: null };
      }
      case "IMAGE":
      case "UNKNOWN":
      default:
        return { status: "UNSUPPORTED", extractedText: null, error: `Aucun parser réel pour le type "${kind}" — image gérée séparément par le Vision Tool, jamais un texte fabriqué ici.` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "FAILED", extractedText: null, error: message };
  }
}
