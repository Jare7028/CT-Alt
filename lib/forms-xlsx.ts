import type { FormsAnswers, FormsField } from './forms-types';
import { FORMS_REPORTING_LIMITS, type FormsReportExportData } from './forms-reporting-types';

const encoder = new TextEncoder();
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCUMENT_RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function oversized(): never {
  throw Object.assign(new Error('Forms workbook exceeds the 8 MiB export limit.'), { status: 413 });
}

function malformed(): never {
  throw Object.assign(new Error('Forms workbook source is invalid.'), { status: 503 });
}

/** Count before allocation; UTF-8 replaces isolated UTF-16 surrogates with U+FFFD. */
function utf8Bytes(value: string, limit: number): number {
  if (value.length > limit) oversized();
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > limit) oversized();
  }
  return bytes;
}

function xmlText(value: string, limit: number): string {
  if (typeof value !== 'string') malformed();
  if (value.length > limit) oversized();
  // The Unicode flag leaves valid surrogate pairs intact. Literal Excel escape
  // sequences must be shielded before encoding controls, including CR, which
  // XML parsers would otherwise normalize to LF.
  const special = /_x[0-9a-fA-F]{4}_|[&<>"'\u0000-\u0008\u000b-\u001f\ud800-\udfff\ufffe\uffff]/gu;
  const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  const pieces: string[] = [];
  let position = 0;
  let bytes = 0;
  for (const match of value.matchAll(special)) {
    const plain = value.slice(position, match.index);
    bytes += utf8Bytes(plain, limit - bytes);
    const token = match[0];
    const escaped = token.length === 7 ? `_x005F_${token.slice(1)}`
      : escapes[token] ?? `_x${token.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`;
    bytes += utf8Bytes(escaped, limit - bytes);
    pieces.push(plain, escaped);
    position = match.index + token.length;
  }
  const tail = value.slice(position);
  utf8Bytes(tail, limit - bytes);
  pieces.push(tail);
  return pieces.join('');
}

/** SpreadsheetML text encoding; exposed for independent preservation checks. */
export function formsReportXmlText(value: string): string {
  return xmlText(value, FORMS_REPORTING_LIMITS.workbookBytes);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

type PackagePart = { name: Uint8Array; chunks: Uint8Array[]; size: number; crc: number };

/** A single shared budget includes payloads, all ZIP headers and the EOCD. */
class StorePackage {
  private size = 22;
  private parts: PackagePart[] = [];

  remaining(): number {
    return FORMS_REPORTING_LIMITS.workbookBytes - this.size;
  }

  private reserve(bytes: number): void {
    if (bytes > this.remaining()) oversized();
    this.size += bytes;
  }

  part(name: string): { append: (value: string) => void } {
    const path = encoder.encode(name);
    this.reserve(30 + 46 + path.length * 2);
    const part: PackagePart = { name: path, chunks: [], size: 0, crc: 0xffffffff };
    this.parts.push(part);
    return {
      append: (value: string) => {
        const length = utf8Bytes(value, this.remaining());
        this.reserve(length);
        const chunk = encoder.encode(value);
        for (const byte of chunk) part.crc = (part.crc >>> 8) ^ crcTable[(part.crc ^ byte) & 0xff];
        part.chunks.push(chunk);
        part.size += length;
      },
    };
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.size);
    const view = new DataView(output.buffer);
    let position = 0;
    const offsets: number[] = [];
    for (const part of this.parts) {
      offsets.push(position);
      view.setUint32(position, 0x04034b50, true);
      view.setUint16(position + 4, 20, true);
      view.setUint16(position + 6, 0x0800, true); // UTF-8; no data descriptor.
      view.setUint16(position + 10, 0, true);
      view.setUint16(position + 12, 0x0021, true); // Deterministic 1980-01-01.
      view.setUint32(position + 14, (part.crc ^ 0xffffffff) >>> 0, true);
      view.setUint32(position + 18, part.size, true);
      view.setUint32(position + 22, part.size, true); // STORE, never compressed.
      view.setUint16(position + 26, part.name.length, true);
      position += 30;
      output.set(part.name, position);
      position += part.name.length;
      for (const chunk of part.chunks) {
        output.set(chunk, position);
        position += chunk.length;
      }
    }
    const directoryOffset = position;
    for (let index = 0; index < this.parts.length; index++) {
      const part = this.parts[index];
      view.setUint32(position, 0x02014b50, true);
      view.setUint16(position + 4, 20, true);
      view.setUint16(position + 6, 20, true);
      view.setUint16(position + 8, 0x0800, true);
      view.setUint16(position + 14, 0x0021, true);
      view.setUint32(position + 16, (part.crc ^ 0xffffffff) >>> 0, true);
      view.setUint32(position + 20, part.size, true);
      view.setUint32(position + 24, part.size, true);
      view.setUint16(position + 28, part.name.length, true);
      view.setUint32(position + 42, offsets[index], true);
      position += 46;
      output.set(part.name, position);
      position += part.name.length;
    }
    const directorySize = position - directoryOffset;
    view.setUint32(position, 0x06054b50, true);
    view.setUint16(position + 8, this.parts.length, true);
    view.setUint16(position + 10, this.parts.length, true);
    view.setUint32(position + 12, directorySize, true);
    view.setUint32(position + 16, directoryOffset, true);
    return output;
  }
}

type Cell = string | number;

function columnName(index: number): string {
  let name = '';
  for (let position = index + 1; position > 0; position = Math.floor((position - 1) / 26)) {
    name = String.fromCharCode(65 + (position - 1) % 26) + name;
  }
  return name;
}

function worksheet(packageFile: StorePackage, path: string): { row: (values: Cell[]) => void; end: () => void } {
  const part = packageFile.part(path);
  part.append(`${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetFormatPr defaultColWidth="24"/><sheetData>`);
  let row = 0;
  return {
    row: (values) => {
      row++;
      part.append(`<row r="${row}">`);
      for (let column = 0; column < values.length; column++) {
        const value = values[column];
        const reference = `${columnName(column)}${row}`;
        if (typeof value === 'number') {
          if (!Number.isSafeInteger(value) || value < 0) malformed();
          part.append(`<c r="${reference}" t="n"><v>${value}</v></c>`);
        } else {
          part.append(`<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">`);
          part.append(xmlText(value, packageFile.remaining()));
          part.append('</t></is></c>');
        }
      }
      part.append('</row>');
    },
    end: () => part.append('</sheetData></worksheet>'),
  };
}

function answerText(field: Exclude<FormsField, { kind: 'description' }>, answers: FormsAnswers): string {
  const answer = answers[field.id];
  if (answer === undefined) return '';
  switch (field.kind) {
    case 'text':
    case 'number':
      if (typeof answer !== 'string') malformed();
      return answer;
    case 'yes_no':
      if (typeof answer !== 'boolean') malformed();
      return answer ? 'Yes' : 'No';
    case 'single_choice': {
      if (typeof answer !== 'string') malformed();
      const option = field.options.find((item) => item.id === answer);
      if (!option) malformed();
      return option.label;
    }
    case 'multiple_choice':
      if (!Array.isArray(answer)) malformed();
      return JSON.stringify(answer.map((id) => {
        const option = field.options.find((item) => item.id === id);
        if (!option) malformed();
        return option.label;
      }));
    default:
      return malformed();
  }
}

/** Build only from the authenticated server's complete validated export DTO. */
export function formsReportWorkbook(data: FormsReportExportData): Uint8Array {
  if (data.kind !== 'entries' && data.kind !== 'status') malformed();
  if (data.kind === 'entries' && data.responses.length > FORMS_REPORTING_LIMITS.submissions) oversized();
  if (data.kind === 'status' && data.users.length > FORMS_REPORTING_LIMITS.assignees) oversized();
  const packageFile = new StorePackage();
  const dataSheet = data.kind === 'entries' ? 'Submissions' : 'Assigned users';
  packageFile.part('[Content_Types].xml').append(`${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  packageFile.part('_rels/.rels').append(`${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIP_NS}"><Relationship Id="rId1" Type="${DOCUMENT_RELATIONSHIP_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  packageFile.part('xl/workbook.xml').append(`${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${DOCUMENT_RELATIONSHIP_NS}"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/><sheet name="${dataSheet}" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  packageFile.part('xl/_rels/workbook.xml.rels').append(`${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIP_NS}"><Relationship Id="rId1" Type="${DOCUMENT_RELATIONSHIP_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${DOCUMENT_RELATIONSHIP_NS}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);

  const report = worksheet(packageFile, 'xl/worksheets/sheet1.xml');
  report.row(['Report', data.kind]);
  report.row(['Company', data.company.name]);
  report.row(['Company ID', data.company.id]);
  report.row(['Current form', data.form.name]);
  report.row(['Form ID', data.form.id]);
  report.row(['Form revision', data.form.revision]);
  report.row(['Actor ID', data.actorId]);
  report.row(['Role', data.role]);
  report.row(['Collection version', data.collectionVersion]);
  report.row(['Timezone', data.company.time_zone]);
  report.row(['Exported at UTC', data.serverTime]);
  report.row(['Date from', data.filters.from ?? '']);
  report.row(['Date to', data.filters.to ?? '']);
  report.row(['Review filter', data.filters.review]);
  report.row(['Search', data.filters.search]);
  report.row(['Submission filter', data.filters.submission]);
  report.row(['Field ID', data.filters.fieldId ?? '']);
  report.row(['Field answer filter', data.filters.fieldAnswer]);
  if (data.kind === 'entries') {
    report.row(['Total submissions', data.counts.total]);
    report.row(['Reviewed submissions', data.counts.reviewed]);
    report.row(['Not reviewed submissions', data.counts.notReviewed]);
  } else {
    report.row(['Total users in filtered scope', data.counts.total]);
    report.row(['Submitted in selected scope', data.counts.submitted]);
    report.row(['Not submitted in selected scope', data.counts.notSubmitted]);
    report.row(['Eligible users in filtered scope', data.counts.eligible]);
    report.row(['All current assignments', data.counts.assignmentTotal]);
    report.row(['Eligible current assignments', data.counts.assignmentEligible]);
  }
  report.end();

  const rows = worksheet(packageFile, 'xl/worksheets/sheet2.xml');
  if (data.kind === 'entries') {
    const fields = data.schema.filter((field): field is Exclude<FormsField, { kind: 'description' }> => field.kind !== 'description');
    rows.row(['Response ID', 'Original actor ID', 'Respondent', 'Original form title', 'First submission UTC', 'Content editor ID', 'Content editor name', 'Content edited UTC', 'Reviewed', 'Reviewer ID', 'Reviewer name', 'Reviewed UTC', ...fields.map((field) => field.label)]);
    for (const response of data.responses) {
      if (response.status !== 'submitted') malformed();
      rows.row([response.id, response.actorId, response.authorName, response.formName, response.submittedAt ?? '', response.lastEditedBy, response.lastEditorName, response.lastEditedAt, response.reviewed ? 'Yes' : 'No', response.reviewedBy ?? '', response.reviewerName ?? '', response.reviewedAt ?? '', ...fields.map((field) => answerText(field, response.answers))]);
    }
  } else {
    rows.row(['Actor ID', 'Retained assignment name', 'Currently eligible', 'Submitted in selected scope', 'Response ID', 'First submission UTC', 'Reviewed', 'Content editor name', 'Content edited UTC']);
    for (const user of data.users) {
      const response = user.response;
      if (response && response.status !== 'submitted') malformed();
      rows.row([user.actorId, user.name, user.eligible ? 'Yes' : 'No', response ? 'Yes' : 'No', response?.id ?? '', response?.submittedAt ?? '', response ? (response.reviewed ? 'Yes' : 'No') : '', response?.lastEditorName ?? '', response?.lastEditedAt ?? '']);
    }
  }
  rows.end();
  return packageFile.finish();
}
