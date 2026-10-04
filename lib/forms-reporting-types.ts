import type { Company } from './agent-types';
import type { FormsAnswers, FormsField, FormsForm, FormsIdentity, FormsResponseSummary } from './forms-types';

export const FORMS_REPORTING_LIMITS = { page: 100, submissions: 10000, answerBytes: 2097152, schemaWorkBytes: 67108864, responseBytes: 8388608, workbookBytes: 8388608, days: 366, assignees: 500 } as const;
export type FormsReportKind = 'entries' | 'status' | 'summary' | 'field';
export type FormsReportFilters = {
  from: string | null;
  to: string | null;
  review: 'all' | 'reviewed' | 'not_reviewed';
  search: string;
  submission: 'all' | 'submitted' | 'not_submitted';
  fieldId: string | null;
  fieldAnswer: 'all' | 'answered' | 'empty';
};
export type FormsReportQuery = { tenantId: string; formId: string; kind: FormsReportKind; filters: FormsReportFilters; limit: number; cursor?: string };
export type FormsReportExportQuery = { tenantId: string; formId: string; kind: 'entries' | 'status'; filters: FormsReportFilters };
export type FormsReportCounts = { total: number; reviewed: number; notReviewed: number };
export type FormsReportBase = FormsIdentity & {
  company: Company;
  form: FormsForm;
  filters: FormsReportFilters;
  collectionVersion: string;
  serverTime: string;
};
export type FormsReportEntries = FormsReportBase & { kind: 'entries'; responses: FormsResponseSummary[]; counts: FormsReportCounts; nextCursor: string | null };
export type FormsReportAssignee = {
  actorId: string;
  name: string;
  eligible: boolean;
  response: FormsResponseSummary | null;
};
export type FormsReportStatusCounts = { total: number; submitted: number; notSubmitted: number; eligible: number; assignmentTotal: number; assignmentEligible: number };
export type FormsReportStatus = FormsReportBase & { kind: 'status'; users: FormsReportAssignee[]; counts: FormsReportStatusCounts; nextCursor: string | null };
export type FormsReportFieldSummary = {
  fieldId: string;
  total: number;
  answered: number;
  empty: number;
  options: { id: string; label: string; count: number }[];
};
export type FormsReportSummary = FormsReportBase & { kind: 'summary'; schema: FormsField[]; counts: FormsReportCounts; fields: FormsReportFieldSummary[] };
export type FormsReportFieldResponse = { response: FormsResponseSummary; answered: boolean; answer: FormsAnswers[string] | null };
export type FormsReportField = FormsReportBase & { kind: 'field'; field: Exclude<FormsField, { kind: 'description' }>; responses: FormsReportFieldResponse[]; counts: { total: number; answered: number; empty: number; matched: number }; nextCursor: string | null };
export type FormsReportData = FormsReportEntries | FormsReportStatus | FormsReportSummary | FormsReportField;
/** Export DTOs exist only inside the authenticated server; browser receives a verified workbook. */
export type FormsReportExportEntry = FormsResponseSummary & { answers: FormsAnswers; formName: string };
export type FormsReportExportEntries = FormsReportBase & { kind: 'entries'; schema: FormsField[]; responses: FormsReportExportEntry[]; counts: FormsReportCounts };
export type FormsReportExportStatus = FormsReportBase & { kind: 'status'; users: FormsReportAssignee[]; counts: FormsReportStatusCounts };
export type FormsReportExportData = FormsReportExportEntries | FormsReportExportStatus;
export type FormsReportExport = { bytes: Uint8Array; filename: string; identity: FormsIdentity; formId: string; collectionVersion: string; formRevision: number };
/** Child handlers must call this gate immediately, including after every await. */
export type FormsReportingProps = {
  identity: FormsIdentity;
  company: Company;
  form: FormsForm;
  canAct: () => boolean;
  onDenied: (message: string) => void;
  onOpenResponse: (responseId: string) => void;
  onClose: () => void;
  disabled: boolean;
};
