/**
 * fileToText.ts
 * Convert non-image file attachments to readable text for inline injection into chat messages.
 *
 * ROOT CAUSE: The OpenClaw gateway's chat.send (parseMessageWithAttachments) sniffs MIME types
 * and explicitly drops anything that isn't an image. Non-image file attachments are silently
 * discarded before reaching the model.
 *
 * FIX: Convert files to text client-side and inject as <file> XML context in the message body.
 * Images still go through the normal gateway attachment path (unchanged).
 */

import * as XLSX from 'xlsx'

export interface ConvertedFile {
  name: string
  text: string
}

/** Convert a base64-encoded file to readable text. */
export async function fileToText(
  base64: string,
  mimeType: string,
  name: string
): Promise<ConvertedFile | null> {
  // Text-based formats: decode directly
  const TEXT_MIMES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'text/html',
    'application/json', 'application/xml', 'text/xml',
  ])
  if (TEXT_MIMES.has(mimeType) || mimeType.startsWith('text/')) {
    try {
      const text = atob(base64)
      return { name, text }
    } catch {
      return null
    }
  }

  // Excel files: use SheetJS to convert to CSV text
  const EXCEL_MIMES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ])
  if (EXCEL_MIMES.has(mimeType)) {
    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const workbook = XLSX.read(bytes, { type: 'array' })
      const parts: string[] = []
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
        if (csv.trim()) parts.push(`[Sheet: ${sheetName}]\n${csv}`)
      }
      return { name, text: parts.length > 0 ? parts.join('\n\n') : '(empty workbook)' }
    } catch (err) {
      return { name, text: `(Excel parse error: ${String(err)})` }
    }
  }

  // PDF / Word / other binary: pass base64 with type hint
  // The model may be able to handle base64-encoded PDFs as document context
  return {
    name,
    text: `[Binary file — base64 encoded, MIME: ${mimeType}]\n${base64}`,
  }
}

/** Convert non-image file attachments to an XML context block for message injection. */
export async function buildFileContext(
  files: Array<{ base64: string; mimeType: string; name?: string }>
): Promise<string> {
  const parts: string[] = []
  for (const f of files) {
    const result = await fileToText(f.base64, f.mimeType, f.name ?? 'attachment')
    if (result) {
      parts.push(`<file name="${escXml(result.name)}">\n${result.text}\n</file>`)
    }
  }
  return parts.join('\n')
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
