import { test, expect } from "@playwright/test";
import { Reports, holdBody, waitBody, releaseBody, version } from "./helpers";
import { forceClick, deferred } from "../forms-browser/guards";
import * as f from "../forms-browser/fixture-data";
let reports: Reports;
test.beforeEach(async ({ page }) => {
  reports = new Reports(page);
  await reports.install();
});
test("desktop reporting keeps original full response history and immutable attribution", async ({
  page,
}) => {
  await reports.open();
  await expect(
    page.getByRole("columnheader", { name: "Last content editor" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open response", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Submission detail", exact: true }),
  ).toBeVisible();
  expect(
    reports.model.calls.some(
      (c) =>
        c.url.pathname === `/api/forms/${f.formId}/responses/${f.responseId}`,
    ),
  ).toBe(true);
});
test("inclusive dates literal search and review apply canonical bounded scope", async ({
  page,
}) => {
  await reports.open();
  await page.getByLabel("From", { exact: true }).fill("2026-03-28");
  await page.getByLabel("To", { exact: true }).fill("2026-03-30");
  await page.getByLabel("Search respondents", { exact: true }).fill("%_\\ İ");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect
    .poll(() => reports.calls.at(-1)?.searchParams.get("search"))
    .toBe("%_\\ İ");
  expect(reports.calls.at(-1)?.searchParams.get("from")).toBe("2026-03-28");
  expect(reports.calls.at(-1)?.searchParams.get("to")).toBe("2026-03-30");
  expect(reports.calls.at(-1)?.searchParams.get("limit")).toBe("50");
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("reviewed");
  await expect
    .poll(() => reports.calls.at(-1)?.searchParams.get("review"))
    .toBe("reviewed");
});
test("invalid or one sided ranges do not read or fabricate counts", async ({
  page,
}) => {
  await reports.open();
  const count = reports.calls.length;
  await page.getByLabel("From", { exact: true }).fill("2026-03-28");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.locator(".fr-error, .forms-message.error")).toContainText(
    "Choose both real dates",
  );
  expect(reports.calls).toHaveLength(count);
  await expect(
    page.getByText("1 submissions · 0 reviewed · 1 not reviewed", {
      exact: true,
    }),
  ).toHaveCount(0);
});
test("status shows all fixed assignments including unavailable and no private progress clues", async ({
  page,
}) => {
  await reports.open();
  await page
    .getByRole("button", { name: "Assigned users", exact: true })
    .click();
  await expect(
    page.locator(".fr-table-wrap").getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", {
      name: "Submitted in all time",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("2 assigned overall · 1 currently eligible", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Assignment status", { exact: true })
    .selectOption("not_submitted");
  await expect
    .poll(() => reports.calls.at(-1)?.searchParams.get("submission"))
    .toBe("not_submitted");
  expect(reports.calls.at(-1)?.searchParams.has("fieldId")).toBe(false);
});
test("all answerable summaries separate false empty and multiple respondent denominator", async ({
  page,
}) => {
  await reports.open();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Equipment safe", exact: true }),
  ).toBeVisible();
  const multiple = page.locator(".fr-summaries article").filter({
    has: page.getByRole("heading", { name: "Checks completed", exact: true }),
  });
  await expect(multiple).toContainText("1 answered · 1 empty · 2 submissions");
  await expect(multiple).toContainText(
    "Percentages use 1 answered respondents; each respondent may select several options.",
  );
  await expect(multiple.getByText("1 · 100.0%", { exact: true })).toHaveCount(
    2,
  );
  await expect(page.locator(".fr-summaries article")).toHaveCount(5);
});
test("field drilldown carries only selected field and reuses original detail reader", async ({
  page,
}) => {
  await reports.open();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await page
    .locator(".fr-summaries article")
    .filter({
      has: page.getByRole("heading", { name: "Meter reading", exact: true }),
    })
    .getByRole("button", { name: "View question responses" })
    .click();
  await expect(
    page.getByText("-123456789012.000001", { exact: true }),
  ).toBeVisible();
  expect(reports.calls.at(-1)?.searchParams.get("fieldId")).toBe(f.fieldId(6));
  await page
    .getByRole("button", { name: "Open response", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Submission detail", exact: true }),
  ).toBeVisible();
});
test("opaque pagination appends unique rows and complete workbook query omits visible cursor", async ({
  page,
}) => {
  reports.next = "opaque-next-cursor";
  await reports.open();
  await page.getByRole("button", { name: "Load more report rows" }).click();
  await expect(
    page.getByText("Example Employee", { exact: true }),
  ).toBeVisible();
  expect(reports.calls.at(-1)?.searchParams.get("cursor")).toBe(
    "opaque-next-cursor",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`forms-${f.formId}-entries.xlsx`);
  const query = reports.calls.at(-1)!;
  expect(query.pathname.endsWith("/export")).toBe(true);
  expect(query.searchParams.has("cursor")).toBe(false);
  expect(query.searchParams.has("limit")).toBe(false);
});
for (const failure of ["version", "duplicate"] as const)
  test(`malformed ${failure} next page clears report without React render crash`, async ({
    page,
  }) => {
    reports.next = "older";
    await reports.open();
    reports.hook = (url, data) => {
      if (url.searchParams.has("cursor") && data.kind === "entries")
        return {
          data:
            failure === "version"
              ? { ...data, collectionVersion: "b".repeat(32) }
              : {
                  ...data,
                  responses: [{ ...data.responses[0], id: f.responseId }],
                },
        };
    };
    await page.getByRole("button", { name: "Load more report rows" }).click();
    await expect(page.locator(".fr-error, .forms-message.error")).toBeVisible();
    await expect(page.locator(".fr-table-wrap")).toHaveCount(0);
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  });
for (const mutation of [
  "identity",
  "counts",
  "filters",
  "form",
  "timestamp",
] as const)
  test(`malformed report ${mutation} fails closed`, async ({ page }) => {
    await reports.open();
    reports.hook = (_url, data) => ({
      data:
        mutation === "identity"
          ? { ...data, actorId: f.otherActor }
          : mutation === "counts"
            ? { ...data, counts: { total: 0, reviewed: 4, notReviewed: 0 } }
            : mutation === "filters"
              ? { ...data, filters: { ...data.filters, search: "foreign" } }
              : mutation === "form"
                ? { ...data, form: { ...data.form, revision: 2 } }
                : { ...data, serverTime: "not-a-date" },
    });
    await page.getByRole("button", { name: "Show all", exact: true }).click();
    await expect(page.locator(".fr-error, .forms-message.error")).toContainText(
      "could not be verified",
    );
    await expect(page.locator(".fr-table-wrap")).toHaveCount(0);
  });
for (const status of [401, 403])
  test(`current report ${status} clears parent private data`, async ({
    page,
  }) => {
    await reports.open();
    reports.hook = () => ({ status, data: null });
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Forms reporting" }),
    ).toHaveCount(0);
    await expect(page.locator(".fr-error, .forms-message.error")).toContainText(
      "Private data has been cleared",
    );
    await expect(
      page.getByRole("button", { name: "Reporting", exact: true }),
    ).toHaveCount(0);
  });
for (const change of [
  "departure",
  "actor",
  "company",
  "role",
  "filter",
] as const)
  test(`decoded report cannot restore after ${change}`, async ({ page }) => {
    await reports.open();
    await holdBody(page, "json");
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    await waitBody(page);
    if (change === "filter")
      await page
        .getByLabel("Search respondents", { exact: true })
        .fill("different");
    else
      await page
        .getByRole("button", {
          name:
            change === "departure"
              ? "Toggle synthetic departure"
              : `Switch synthetic ${change}`,
          exact: true,
        })
        .click();
    await releaseBody(page);
    await expect(page.locator(".fr-summaries")).toHaveCount(0);
  });
for (const change of [
  "departure",
  "actor",
  "company",
  "role",
  "filter",
  "close",
] as const)
  test(`decoded workbook creates no URL or click after ${change}`, async ({
    page,
  }) => {
    await reports.open();
    await holdBody(page, "blob");
    await page
      .getByRole("button", { name: "Export XLSX", exact: true })
      .click();
    await waitBody(page);
    if (change === "filter")
      await page
        .getByLabel("Search respondents", { exact: true })
        .fill("newscope");
    else
      await page
        .getByRole("button", {
          name:
            change === "close"
              ? "Close reporting"
              : change === "departure"
                ? "Toggle synthetic departure"
                : `Switch synthetic ${change}`,
          exact: true,
        })
        .click();
    await releaseBody(page);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { reportUrls: number; reportClicks: number })
            .reportUrls,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { reportClicks: number }).reportClicks,
      ),
    ).toBe(0);
  });
for (const header of [
  "x-ct-alt-actor-id",
  "x-ct-alt-company-id",
  "x-ct-alt-form-id",
  "x-ct-alt-role",
  "x-ct-alt-collection-version",
  "x-ct-alt-form-revision",
  "x-ct-alt-report-kind",
  "content-type",
  "content-disposition",
  "x-content-type-options",
])
  test(`workbook rejects mismatched ${header}`, async ({ page }) => {
    await reports.open();
    reports.hook = (url) =>
      url.pathname.endsWith("/export")
        ? {
            headers: { ...reports.headers(), [header]: "wrong" },
            body: Buffer.from("never downloaded"),
          }
        : undefined;
    await page
      .getByRole("button", { name: "Export XLSX", exact: true })
      .click();
    await expect(page.locator(".fr-error, .forms-message.error")).toContainText(
      "could not be verified",
    );
  });
test("provider error body and oversized workbook header never download", async ({
  page,
}) => {
  await reports.open();
  reports.hook = (url) =>
    url.pathname.endsWith("/export")
      ? { status: 413, data: { error: "internal secret must not echo" } }
      : undefined;
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  await expect(page.locator(".fr-error, .forms-message.error")).toContainText(
    "complete workbook is too large",
  );
  await expect(page.getByText("internal secret must not echo")).toHaveCount(0);
  reports.hook = (url) =>
    url.pathname.endsWith("/export")
      ? {
          headers: { ...reports.headers(), "content-length": String(8388609) },
          body: Buffer.from("small"),
        }
      : undefined;
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  await expect(page.locator(".fr-error, .forms-message.error")).toContainText(
    "size could not be verified",
  );
});
test("real React Reporting handler denies during held parent mutation and unknown recovery", async ({
  page,
}) => {
  await reports.open();
  await page.getByRole("button", { name: "Close reporting" }).click();
  const hold = deferred();
  reports.model.hook = async (call) => {
    if (call.body) {
      await hold.promise;
      return { abort: true };
    }
  };
  await page.getByRole("button", { name: "Archive form", exact: true }).click();
  const count = reports.calls.length;
  await forceClick(page, "Reporting");
  expect(reports.calls).toHaveLength(count);
  hold.resolve();
  await expect(
    page.getByRole("region", { name: "Forms recovery" }),
  ).toBeVisible();
  await forceClick(page, "Reporting");
  expect(reports.calls).toHaveLength(count);
});
test("desktop captures entries assigned status and question summary", async ({
  page,
}) => {
  await reports.open();
  await page.setViewportSize({ width: 1444, height: 1050 });
  await page.screenshot({
    path: "/tmp/ct-alt-forms-reporting-entries-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Assigned users", exact: true })
    .click();
  await expect(
    page.locator(".fr-table-wrap").getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/ct-alt-forms-reporting-status-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await expect(page.locator(".fr-summaries article")).toHaveCount(5);
  await page.screenshot({
    path: "/tmp/ct-alt-forms-reporting-summary-desktop.png",
    fullPage: true,
  });
  expect(version).toHaveLength(32);
});

test("empty summaries show genuine zero counts without percentages", async ({
  page,
}) => {
  await reports.open();
  reports.hook = (_url, data) =>
    data.kind === "summary"
      ? {
          data: {
            ...data,
            counts: { total: 0, reviewed: 0, notReviewed: 0 },
            fields: data.fields.map((field) => ({
              ...field,
              total: 0,
              answered: 0,
              empty: 0,
              options: field.options.map((option) => ({ ...option, count: 0 })),
            })),
          },
        }
      : undefined;
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await expect(page.locator(".fr-summaries article")).toHaveCount(5);
  await expect(page.getByText("No responses.", { exact: true })).toHaveCount(3);
  await expect(page.locator(".fr-distribution")).toHaveCount(0);
  await expect(
    page.getByText("0 submissions · 0 reviewed · 0 not reviewed", {
      exact: true,
    }),
  ).toBeVisible();
});

test("accepted decoded workbook clicks once and revokes its private object URL", async ({
  page,
}) => {
  await reports.open();
  await holdBody(page, "blob");
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  await waitBody(page);
  const downloaded = page.waitForEvent("download");
  await releaseBody(page);
  expect((await downloaded).suggestedFilename()).toBe(
    `forms-${f.formId}-entries.xlsx`,
  );
  expect(
    await page.evaluate(() => {
      const state = window as unknown as {
        reportUrls: number;
        reportClicks: number;
        reportRevokes: number;
      };
      return [state.reportUrls, state.reportClicks, state.reportRevokes];
    }),
  ).toEqual([1, 1, 1]);
  await expect(page.locator("a[download]")).toHaveCount(0);
});

test("workbook headers are rechecked after decoded body before URL creation", async ({
  page,
}) => {
  await reports.open();
  await holdBody(page, "blob");
  await page.evaluate(() => {
    const fetchOriginal = window.fetch;
    window.fetch = async (input, init) => {
      const result = await fetchOriginal(input, init);
      if (String(input).includes("/reports/export")) {
        const consume = result.blob.bind(result);
        result.blob = async () => {
          const blob = await consume();
          const read = result.headers.get.bind(result.headers);
          result.headers.get = (name) =>
            name.toLowerCase() === "x-ct-alt-actor-id"
              ? "wrong-after-body"
              : read(name);
          return blob;
        };
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  await waitBody(page);
  await releaseBody(page);
  await expect(page.locator(".fr-error")).toContainText(
    "identity or size could not be verified",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { reportUrls: number }).reportUrls,
    ),
  ).toBe(0);
});
