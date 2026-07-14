declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseResult = {
    text: string;
    numpages: number;
    info?: Record<string, unknown>;
  };

  type PdfParser = (data: Uint8Array | ArrayBuffer) => Promise<PdfParseResult>;
  const pdfParse: PdfParser;
  export default pdfParse;
}
