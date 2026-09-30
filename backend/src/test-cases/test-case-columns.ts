// Built-in bulk import/export columns for test cases, and the header
// matching both TestCasesService.bulkImport() and custom field naming
// (TestCaseCustomFieldsService) rely on.
//
// Headers are matched loosely so a team's existing spreadsheet imports
// without renaming every column first: case, spaces, underscores, hyphens
// and a trailing "*" (a common "required" marker) are all ignored, so
// "Expected Result", "expected_result" and "expectedResult*" all map to
// expectedResult. A few common synonyms are accepted too (e.g. "Project",
// "Test Steps", "Tags").

export const BUILT_IN_COLUMNS = [
  'title',
  'description',
  'preconditions',
  'steps',
  'expectedResult',
  'priority',
  'category',
  'projectName',
  'moduleName',
  'phaseName',
  'labels',
] as const;

export type BuiltInColumn = (typeof BUILT_IN_COLUMNS)[number] | 'caseNumber';

export const REQUIRED_COLUMNS: BuiltInColumn[] = ['title', 'steps', 'expectedResult'];

export function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/\*+$/, '')
    .replace(/[\s_\-]+/g, '');
}

// Normalized header -> canonical column.
const BUILT_IN_ALIASES: Record<string, BuiltInColumn> = {
  title: 'title',
  testcasetitle: 'title',
  testcasename: 'title',
  description: 'description',
  preconditions: 'preconditions',
  precondition: 'preconditions',
  prerequisites: 'preconditions',
  steps: 'steps',
  teststeps: 'steps',
  expectedresult: 'expectedResult',
  expectedresults: 'expectedResult',
  priority: 'priority',
  category: 'category',
  projectname: 'projectName',
  project: 'projectName',
  modulename: 'moduleName',
  module: 'moduleName',
  phasename: 'phaseName',
  phase: 'phaseName',
  labels: 'labels',
  label: 'labels',
  tags: 'labels',
  casenumber: 'caseNumber',
};

// Columns our own export writes that import deliberately doesn't set -
// status/reviewStatus are driven by the portal's own workflow. Recognized
// so re-importing an export warns clearly instead of calling them unknown.
const EXPORT_ONLY_HEADERS = new Set(['status', 'reviewstatus']);

export function builtInColumnFor(header: string): BuiltInColumn | undefined {
  return BUILT_IN_ALIASES[normalizeHeader(header)];
}

export function isExportOnlyHeader(header: string): boolean {
  return EXPORT_ONLY_HEADERS.has(normalizeHeader(header));
}

// A custom field name can't normalize to anything import already treats
// as a built-in (or export-only) column, or its values would be read
// into the wrong place.
export function isReservedFieldName(name: string): boolean {
  const normalized = normalizeHeader(name);
  return normalized in BUILT_IN_ALIASES || EXPORT_ONLY_HEADERS.has(normalized) || normalized === 'id';
}
