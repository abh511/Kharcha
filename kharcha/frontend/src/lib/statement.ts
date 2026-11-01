/** Thrown when a PDF is password-protected (many Indian bank statements are) or the password was wrong. */
export class NeedsPassword extends Error {
  readonly wrong: boolean;
  constructor(wrong: boolean) {
    super(wrong ? 'That password didn’t work.' : 'This PDF is password-protected.');
    this.wrong = wrong;
  }
}

/**
 * CSV is sent as-is. A PDF is turned into text lines right here in the browser
 * (the file itself never leaves the device): words at the same height on a
 * page become one line, left to right.
 */
export async function readStatement(file: File, password?: string): Promise<{ format: 'csv' | 'pdf'; text: string }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return { format: 'csv', text: await file.text() };

  // Loaded only when someone actually picks a PDF: it's the largest dependency by far.
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err instanceof pdfjs.PasswordException) throw new NeedsPassword(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    throw new Error('This PDF couldn’t be read. Is it a bank statement?');
  }

  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const [x, y] = [item.transform[4] as number, item.transform[5] as number];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '));
  }
  await task.destroy();
  return { format: 'pdf', text: lines.join('\n') };
}
