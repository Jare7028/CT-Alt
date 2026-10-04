import { expect, type Page } from "@playwright/test";
import type {
  FormsAnswers,
  FormsAssignee,
  FormsChange,
  FormsFormData,
  FormsHistoryItem,
  FormsMutation,
  FormsResponse,
  FormsSaved,
  FormsView,
} from "../../lib/forms-types";
import * as f from "./fixture-data";
export type Call = { url: URL; method: string; body: FormsMutation | null };
export type Reply = { status?: number; data?: unknown; abort?: boolean };
export const markerKey = `ct-alt:forms:${f.actor}:${f.company.id}`;
export class Model {
  calls: Call[] = [];
  hook: ((call: Call) => Reply | void | Promise<Reply | void>) | null = null;
  response: FormsResponse | null = null;
  history: FormsHistoryItem[] = [];
  forms = [f.form(), f.form(f.draftId, "draft")];
  schema = structuredClone(f.schema);
  audiences = new Map([
    [f.formId, [f.actor, f.otherActor]],
    [f.draftId, [] as string[]],
  ]);
  receipts = new Map<string, FormsSaved>();
  roster: FormsAssignee[] = Array.from({ length: 1005 }, (_, index) => ({
    actorId: `99999999-9999-4999-8999-${String(index + 1).padStart(12, "0")}`,
    name: `Example Person ${String(index + 1).padStart(4, "0")}`,
    eligible: true,
  }));
  constructor(public page: Page) {
    this.roster.unshift({
      actorId: f.actor,
      name: "Example Owner",
      eligible: true,
    });
  }
  identity() {
    return { tenantId: f.company.id, actorId: f.actor, role: "owner" as const };
  }
  scopedForm(id: string, view: FormsView) {
    const source = this.forms.find((item) => item.id === id)!;
    const result = {
      ...f.form(
        id,
        source.status,
        view,
        (this.audiences.get(id) ?? []).includes(f.actor),
      ),
      ...source,
      capabilities: f.form(id, source.status, view).capabilities,
      isAssigned: (this.audiences.get(id) ?? []).includes(f.actor),
      audienceCount:
        view === "manage" ? (this.audiences.get(id) ?? []).length : null,
      eligibleAudienceCount:
        view === "manage" ? (this.audiences.get(id) ?? []).length : null,
    };
    if (this.response?.formId === id) {
      result.ownResponse = {
        id: this.response.id,
        revision: this.response.revision,
        status: this.response.status,
        submittedAt: this.response.submittedAt,
        updatedAt: this.response.updatedAt,
      };
      if (view === "mine" && this.response.status === "submitted") {
        result.capabilities.canSaveProgress = false;
        result.capabilities.canSubmit = false;
        result.capabilities.canEditResponse = result.allowRespondentEdit;
      }
    }
    return result;
  }
  detail(id: string, view: FormsView): FormsFormData {
    const shared = {
      ...this.identity(),
      company: f.company,
      form: this.scopedForm(id, view),
      schema: this.schema,
      collectionVersion: "9007199254740993",
      serverTime: f.instant,
    };
    return view === "mine"
      ? {
          ...shared,
          view,
          response: this.response?.formId === id ? this.response : null,
        }
      : {
          ...shared,
          view,
          assignees: (this.audiences.get(id) ?? []).map(
            (actorId) =>
              this.roster.find((user) => user.actorId === actorId) ?? {
                actorId,
                name: "Example Colleague",
                eligible: true,
              },
          ),
        };
  }
  submitted(
    answers: FormsAnswers = {
      [f.fieldId(2)]: "Safe team",
      [f.fieldId(3)]: true,
      [f.fieldId(4)]: f.optionId(1),
      [f.fieldId(5)]: [f.optionId(3)],
      [f.fieldId(6)]: "12.5",
    },
  ) {
    this.response = {
      id: f.responseId,
      formId: f.formId,
      actorId: f.actor,
      authorName: "Example Owner",
      revision: 1,
      status: "submitted",
      submittedAt: f.instant,
      updatedAt: f.instant,
      lastEditedBy: f.actor,
      lastEditedAt: f.instant,
      lastEditorName: "Example Owner",
      reviewed: false,
      reviewedAt: null,
      reviewedBy: null,
      reviewerName: null,
      canEdit: true,
      canReview: true,
      answers,
      schema: this.schema,
      formName: "Daily readiness",
    };
  }
  apply(change: FormsChange, operationId: string): FormsSaved {
    const id =
      "formId" in change
        ? change.formId
        : "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
    if (change.action === "create_form") {
      this.forms.push({
        ...f.form(id, "draft"),
        name: change.name,
        description: change.description,
        allowRespondentEdit: change.allowRespondentEdit,
      });
      this.schema = change.schema;
      this.audiences.set(id, change.audienceIds);
    }
    const form = this.forms.find((item) => item.id === id)!;
    if (change.action === "edit_form")
      Object.assign(form, {
        name: change.name,
        description: change.description,
        allowRespondentEdit: change.allowRespondentEdit,
        revision: form.revision + 1,
      });
    if (change.action === "set_audience") {
      this.audiences.set(id, change.audienceIds);
      form.revision++;
    }
    if (change.action === "publish_form") {
      form.status = "published";
      form.schemaFrozen = true;
      form.revision++;
    }
    if (change.action === "archive_form") {
      form.restoreStatus = form.status === "draft" ? "draft" : "published";
      form.status = "archived";
      form.revision++;
    }
    if (change.action === "restore_form") {
      form.status = form.restoreStatus!;
      form.restoreStatus = null;
      form.revision++;
    }
    if ("answers" in change) {
      if (this.response?.status === "submitted") {
        const { id: responseId, ...previous } = this.response;
        this.history.unshift({
          ...previous,
          id: `88888888-8888-4888-8888-${String(this.history.length + 1).padStart(12, "0")}`,
          responseId,
          retainedAt: f.instant,
        });
      }
      const revision = (this.response?.revision ?? 0) + 1,
        submitted = change.action !== "save_progress";
      if (!this.response) this.submitted({});
      Object.assign(this.response!, {
        revision,
        answers: change.answers,
        status: submitted ? "submitted" : "in_progress",
        submittedAt: submitted
          ? (this.response!.submittedAt ?? f.instant)
          : null,
        reviewed: false,
      });
    }
    if (change.action === "review_response")
      Object.assign(this.response!, {
        revision: this.response!.revision + 1,
        reviewed: change.reviewed,
        reviewerName: change.reviewed ? "Example Owner" : null,
      });
    const saved: FormsSaved = {
      ...this.identity(),
      operationId,
      action: change.action,
      formId: id,
      formRevision: form.revision,
      updatedAt: f.instant,
      ...([
        "save_progress",
        "submit_response",
        "edit_response",
        "admin_edit_response",
        "review_response",
      ].includes(change.action)
        ? {
            responseId: this.response!.id,
            responseRevision: this.response!.revision,
            responseStatus: this.response!.status,
            submittedAt: this.response!.submittedAt,
          }
        : {}),
    };
    this.receipts.set(operationId, saved);
    return saved;
  }
  async install() {
    await this.page.route("**/api/forms**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method(),
        body =
          method === "POST" ? (request.postDataJSON() as FormsMutation) : null;
      const call = { url, method, body };
      this.calls.push(call);
      const reply = await this.hook?.(call);
      if (reply?.abort) {
        await route.abort();
        return;
      }
      if (reply) {
        await route.fulfill({
          status: reply.status ?? 200,
          json: reply.data ?? {},
        });
        return;
      }
      const pathname = url.pathname,
        view = (url.searchParams.get("view") ?? "mine") as FormsView;
      let data: unknown;
      if (pathname === "/api/forms/reconcile") {
        const value = body as unknown as {
          operationId: string;
          action: FormsChange["action"];
        };
        const saved = this.receipts.get(value.operationId) ?? null;
        data = {
          ...this.identity(),
          ...value,
          status: saved ? "recorded" : "not_recorded",
          saved,
        };
      } else if (pathname === "/api/forms" && body)
        data = { saved: this.apply(body.change, body.operationId) };
      else if (pathname === "/api/forms/roster") {
        const term = url.searchParams.get("search") ?? "",
          matched = this.roster.filter((user) => user.name.includes(term)),
          offset = Number(url.searchParams.get("cursor") ?? "0");
        data = {
          ...this.identity(),
          users: matched.slice(offset, offset + 50),
          matchedCount: matched.length,
          rosterVersion: "9007199254740993",
          nextCursor: offset + 50 < matched.length ? String(offset + 50) : null,
          serverTime: f.instant,
        };
      } else if (pathname === "/api/forms") {
        const status = url.searchParams.get("status"),
          term = url.searchParams.get("search") ?? "";
        const forms = this.forms
          .filter(
            (form) =>
              (view === "manage" ||
                (form.status === "published" &&
                  (this.audiences.get(form.id) ?? []).includes(f.actor))) &&
              (status === "all" || !status || form.status === status) &&
              form.name.includes(term),
          )
          .map((form) => this.scopedForm(form.id, view));
        data = {
          ...this.identity(),
          company: f.company,
          view,
          forms,
          counts: {
            total: forms.length,
            draft: forms.filter((form) => form.status === "draft").length,
            published: forms.filter((form) => form.status === "published")
              .length,
            archived: forms.filter((form) => form.status === "archived").length,
          },
          catalogVersion: "9007199254740993",
          nextCursor: null,
          capabilities: { canManage: true },
          serverTime: f.instant,
        };
      } else {
        const segments = pathname.split("/"),
          id = segments[3];
        if (segments[4] === "responses") {
          const form = this.scopedForm(id, "manage"),
            response =
              this.response?.status === "submitted" ? this.response : null;
          data = segments[5]
            ? {
                ...this.identity(),
                form,
                response,
                history: this.history,
                historyCount: this.history.length,
                collectionVersion: "9007199254740993",
                nextCursor: null,
                serverTime: f.instant,
              }
            : {
                ...this.identity(),
                form,
                responses: response ? [response] : [],
                counts: {
                  total: response ? 1 : 0,
                  reviewed: response?.reviewed ? 1 : 0,
                  notReviewed: response && !response.reviewed ? 1 : 0,
                },
                collectionVersion: "9007199254740993",
                nextCursor: null,
                serverTime: f.instant,
              };
        } else data = this.detail(id, view);
      }
      await route.fulfill({ json: data });
    });
    await this.page.goto("/forms-test-fixture");
    await expect(
      this.page.getByRole("heading", { name: "Forms", exact: true }),
    ).toBeVisible();
  }
  posts() {
    return this.calls.filter(
      (call) => call.method === "POST" && call.url.pathname === "/api/forms",
    );
  }
}
export async function openForm(page: Page) {
  await page
    .getByRole("button", { name: "Open form Daily readiness", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes", { exact: true })).toBeVisible();
}
export async function manage(page: Page) {
  await page.getByRole("button", { name: "Manage forms", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create form", exact: true }),
  ).toBeVisible();
}
export async function complete(page: Page) {
  await page
    .getByLabel("Shift notes", { exact: true })
    .fill("  Ready\n<script>escaped</script> 😀");
  await page.getByLabel("Yes", { exact: true }).check();
  await page
    .getByLabel("Work area", { exact: true })
    .selectOption(f.optionId(1));
  await page.getByLabel("Doors", { exact: true }).check();
  await page.getByLabel("Meter reading", { exact: true }).fill("123.000001");
}
