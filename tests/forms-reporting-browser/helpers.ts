import { expect, type Page } from "@playwright/test";
import { Model, manage, openForm } from "../forms-browser/helpers";
import * as f from "../forms-browser/fixture-data";
import type { FormsResponse } from "../../lib/forms-types";
import type {
  FormsReportData,
  FormsReportFilters,
  FormsReportKind,
} from "../../lib/forms-reporting-types";
import { formsReportWorkbook } from "../../lib/forms-xlsx";
export const instant = "2026-10-04T09:12:00.123456Z",
  version = "a".repeat(32);
export function response(id = f.responseId, actor = f.actor): FormsResponse {
  return {
    id,
    formId: f.formId,
    actorId: actor,
    authorName: actor === f.actor ? "Example Owner" : "Example Employee",
    revision: 1,
    status: "submitted",
    submittedAt: instant,
    updatedAt: instant,
    lastEditedBy: actor,
    lastEditorName: "Example Editor",
    lastEditedAt: instant,
    reviewed: false,
    reviewedAt: null,
    reviewedBy: null,
    reviewerName: null,
    canEdit: true,
    canReview: true,
    answers: {
      [f.fieldId(2)]: "Exact original 😀",
      [f.fieldId(3)]: false,
      [f.fieldId(4)]: f.optionId(1),
      [f.fieldId(5)]: [f.optionId(3), f.optionId(4)],
      [f.fieldId(6)]: "-123456789012.000001",
    },
    schema: f.schema,
    formName: "Original form title",
  };
}
export type Reply = {
  status?: number;
  data?: unknown;
  headers?: Record<string, string>;
  body?: Buffer;
};
export class Reports {
  calls: URL[] = [];
  hook:
    | ((
        url: URL,
        data: FormsReportData,
      ) => Reply | undefined | Promise<Reply | undefined>)
    | null = null;
  model: Model;
  next: string | null = null;
  constructor(public page: Page) {
    this.model = new Model(page);
    this.model.response = response();
  }
  dto(url: URL): FormsReportData {
    const kind = (url.searchParams.get("kind") ?? "entries") as FormsReportKind,
      filters: FormsReportFilters = {
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        review: (url.searchParams.get("review") ??
          "all") as FormsReportFilters["review"],
        search: url.searchParams.get("search") ?? "",
        submission: (url.searchParams.get("submission") ??
          "all") as FormsReportFilters["submission"],
        fieldId: url.searchParams.get("fieldId"),
        fieldAnswer: (url.searchParams.get("fieldAnswer") ??
          "all") as FormsReportFilters["fieldAnswer"],
      };
    const base = {
      tenantId: f.company.id,
      actorId: f.actor,
      role: "owner" as const,
      company: f.company,
      form: f.form(f.formId, "published", "manage"),
      filters,
      collectionVersion: version,
      serverTime: instant,
    };
    const r = response();
    if (kind === "entries")
      return {
        ...base,
        kind,
        counts: {
          total: this.next ? 2 : 1,
          reviewed: 0,
          notReviewed: this.next ? 2 : 1,
        },
        responses: [
          url.searchParams.has("cursor")
            ? {
                ...r,
                id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
                actorId: f.otherActor,
                authorName: "Example Employee",
              }
            : r,
        ],
        nextCursor: url.searchParams.has("cursor") ? null : this.next,
      };
    if (kind === "status")
      return {
        ...base,
        kind,
        counts: {
          total: 2,
          submitted: 1,
          notSubmitted: 1,
          eligible: 1,
          assignmentTotal: 2,
          assignmentEligible: 1,
        },
        users: [
          {
            actorId: f.actor,
            name: "Example Owner",
            eligible: true,
            response: r,
          },
          {
            actorId: f.otherActor,
            name: "Example Employee",
            eligible: false,
            response: null,
          },
        ],
        nextCursor: null,
      };
    if (kind === "summary") {
      const schema = structuredClone(f.schema).map((field) =>
        field.kind === "text" || field.kind === "multiple_choice"
          ? { ...field, required: false }
          : field,
      );
      return {
        ...base,
        kind,
        schema,
        counts: { total: 2, reviewed: 0, notReviewed: 2 },
        fields: schema
          .filter((field) => field.kind !== "description")
          .map((field) => ({
            fieldId: field.id,
            total: 2,
            answered:
              field.kind === "text" || field.kind === "multiple_choice" ? 1 : 2,
            empty:
              field.kind === "text" || field.kind === "multiple_choice" ? 1 : 0,
            options:
              field.kind === "yes_no"
                ? [
                    { id: "true", label: "Yes", count: 0 },
                    { id: "false", label: "No", count: 2 },
                  ]
                : field.kind === "single_choice" ||
                    field.kind === "multiple_choice"
                  ? field.options.map((option) => ({ ...option, count: 1 }))
                  : [],
          })),
      };
    }
    const field = f.schema.find((field) => field.id === filters.fieldId)!;
    if (field.kind === "description")
      throw Error("Informational field has no responses");
    return {
      ...base,
      kind,
      field,
      responses: [{ response: r, answered: true, answer: r.answers[field.id] }],
      counts: { total: 1, answered: 1, empty: 0, matched: 1 },
      nextCursor: null,
    };
  }
  headers(kind = "entries") {
    return {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="forms-${f.formId}-${kind}.xlsx"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "x-ct-alt-actor-id": f.actor,
      "x-ct-alt-company-id": f.company.id,
      "x-ct-alt-form-id": f.formId,
      "x-ct-alt-role": "owner",
      "x-ct-alt-collection-version": version,
      "x-ct-alt-form-revision": "1",
      "x-ct-alt-report-kind": kind,
    };
  }
  async install() {
    await this.model.install();
    await this.page.route("**/api/forms/*/reports**", async (route) => {
      const url = new URL(route.request().url());
      this.calls.push(url);
      const data = this.dto(url),
        reply = await this.hook?.(url, data);
      if (reply) {
        await route.fulfill({
          status: reply.status ?? 200,
          ...(reply.body
            ? {
                body: reply.body,
                headers:
                  reply.headers ??
                  this.headers(url.searchParams.get("kind") ?? "entries"),
              }
            : { json: reply.data ?? data, headers: reply.headers }),
        });
        return;
      }
      if (url.pathname.endsWith("/export")) {
        if (data.kind !== "entries" && data.kind !== "status")
          throw Error("Unsupported fixture export");
        const exportData =
          data.kind === "status"
            ? data
            : {
                ...data,
                schema: f.schema,
                responses: this.next
                  ? [
                      response(),
                      response(
                        "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
                        f.otherActor,
                      ),
                    ]
                  : [response()],
              };
        await route.fulfill({
          headers: this.headers(data.kind),
          body: Buffer.from(formsReportWorkbook(exportData)),
        });
      } else await route.fulfill({ json: data });
    });
  }
  async open() {
    await manage(this.page);
    await openForm(this.page);
    await this.page
      .getByRole("button", { name: "Reporting", exact: true })
      .click();
    await expect(
      this.page.getByRole("region", { name: "Forms reporting" }),
    ).toBeVisible();
    await expect(
      this.page.getByRole("columnheader", { name: "Respondent", exact: true }),
    ).toBeVisible();
  }
}
export async function holdBody(page: Page, kind: "json" | "blob") {
  await page.evaluate((kind) => {
    const original = window.fetch;
    let release!: () => void;
    const promise = new Promise<void>((done) => (release = done));
    Object.assign(window, {
      reportRelease: release,
      reportHeld: false,
      reportUrls: 0,
      reportClicks: 0,
      reportRevokes: 0,
    });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      (window as unknown as { reportUrls: number }).reportUrls++;
      return create(blob);
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      (window as unknown as { reportRevokes: number }).reportRevokes++;
      revoke(url);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      (window as unknown as { reportClicks: number }).reportClicks++;
      click.call(this);
    };
    window.fetch = async (input, init) => {
      const result = await original(input, init);
      if (
        String(input).includes("/reports") &&
        (kind === "blob"
          ? String(input).includes("/export")
          : !String(input).includes("/export"))
      ) {
        if (kind === "blob") {
          const consume = result.blob.bind(result);
          result.blob = async () => {
            const body = await consume();
            Object.assign(window, { reportHeld: true });
            await promise;
            return body;
          };
        } else {
          const consume = result.json.bind(result);
          result.json = async () => {
            const body = await consume();
            Object.assign(window, { reportHeld: true });
            await promise;
            return body;
          };
        }
      }
      return result;
    };
  }, kind);
}
export async function waitBody(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => !!(window as unknown as { reportHeld: boolean }).reportHeld,
      ),
    )
    .toBe(true);
}
export async function releaseBody(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { reportRelease: () => void }).reportRelease(),
  );
}
