import { test, expect } from "@playwright/test";
import { Model, complete, manage, markerKey, openForm } from "./helpers";
import {
  deferred,
  forceClick,
  holdAcknowledgment,
  releaseAcknowledgment,
  waitAcknowledgment,
} from "./guards";
import * as f from "./fixture-data";
let model: Model;
test.beforeEach(async ({ page }) => {
  model = new Model(page);
  await model.install();
});

test("desktop separates assigned forms and management with original text-only fields", async ({
  page,
}) => {
  await openForm(page);
  await expect(
    page.getByText(f.schema[0].kind === "description" ? f.schema[0].text : ""),
  ).toBeVisible();
  await expect(page.getByLabel("Shift notes")).toBeVisible();
  await expect(page.getByLabel("Meter reading")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish form", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to forms", exact: true })
    .click();
  await manage(page);
  await openForm(page);
  await expect(
    page.getByText(
      "Management does not submit a response. Use My forms if you are also assigned.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send response", exact: true }),
  ).toHaveCount(0);
});
test("debounced partial autosave durably reloads original answers with no progress history", async ({
  page,
}) => {
  await openForm(page);
  await page.getByLabel("Shift notes").fill("Incomplete but saved 😀");
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
  expect(model.posts()).toHaveLength(1);
  expect(model.posts()[0].body?.change?.action).toBe("save_progress");
  expect(model.history).toHaveLength(0);
  await page
    .getByRole("button", { name: "Refresh Forms", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue(
    "Incomplete but saved 😀",
  );
});
test("unsent debounce is described as unsaved and never persisted in recovery marker", async ({
  page,
}) => {
  await openForm(page);
  await page.getByLabel("Shift notes").fill("unsent local answer");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic departure", { exact: true }),
  ).toBeVisible();
  expect(model.posts()).toHaveLength(0);
});
test("later edits serialize behind a held save against the acknowledged revision", async ({
  page,
}) => {
  await openForm(page);
  const held = deferred();
  let first = true;
  model.hook = async (call) => {
    if (call.body?.change?.action === "save_progress" && first) {
      first = false;
      const saved = model.apply(call.body.change, call.body.operationId);
      await held.promise;
      return { data: { saved } };
    }
  };
  await page.getByLabel("Shift notes").fill("First");
  await expect.poll(() => model.posts().length).toBe(1);
  await page.getByLabel("Shift notes").fill("Second in-memory edit");
  expect(model.posts()).toHaveLength(1);
  held.resolve();
  await expect.poll(() => model.posts().length).toBe(2);
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
  expect(model.posts()[0].body?.operationId).not.toBe(
    model.posts()[1].body?.operationId,
  );
  const second = model.posts()[1].body!.change;
  expect("responseRevision" in second && second.responseRevision).toBe(1);
  expect("answers" in second && second.answers[f.fieldId(2)]).toBe(
    "Second in-memory edit",
  );
});
test("Send flushes all current field types before one explicit submission", async ({
  page,
}) => {
  await openForm(page);
  await complete(page);
  await page
    .getByRole("button", { name: "Send response", exact: true })
    .click();
  await expect(
    page.getByText("Your response was submitted.", { exact: true }),
  ).toBeVisible();
  expect(model.posts().map((call) => call.body!.change.action)).toEqual([
    "save_progress",
    "submit_response",
  ]);
  expect(model.response?.answers[f.fieldId(3)]).toBe(true);
  expect(model.response?.answers[f.fieldId(5)]).toEqual([f.optionId(3)]);
  expect(model.response?.answers[f.fieldId(6)]).toBe("123.000001");
  expect(model.history).toHaveLength(0);
});
test("required answers prevent submission without blocking partial saved progress", async ({
  page,
}) => {
  await openForm(page);
  await page.getByLabel("Shift notes").fill("Only a note");
  await page
    .getByRole("button", { name: "Send response", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "Complete Equipment safe",
  );
  expect(model.posts().map((call) => call.body!.change.action)).toEqual([
    "save_progress",
  ]);
});
for (const value of ["1e3", "Infinity", "1234567890123", "1.1234567"])
  test(`numeric submission rejects ${value}`, async ({ page }) => {
    await openForm(page);
    await complete(page);
    await page.getByLabel("Meter reading").fill(value);
    await page
      .getByRole("button", { name: "Send response", exact: true })
      .click();
    await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
      "decimal number",
    );
    expect(
      model
        .posts()
        .some((call) => call.body?.change?.action === "submit_response"),
    ).toBe(false);
  });
test("incomplete decimal progress is retained while typing", async ({
  page,
}) => {
  await openForm(page);
  await page.getByLabel("Meter reading").fill("-");
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
  expect(model.response?.answers[f.fieldId(6)]).toBe("-");
});
test("known revision conflict retains local content and requires explicit current refresh", async ({
  page,
}) => {
  await openForm(page);
  let conflict = true;
  model.hook = (call) => {
    if (call.body?.change?.action === "save_progress" && conflict) {
      conflict = false;
      return { status: 409 };
    }
  };
  await page.getByLabel("Shift notes").fill("Keep this original local note");
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "local answers are retained",
  );
  await expect(page.getByLabel("Shift notes")).toHaveValue(
    "Keep this original local note",
  );
  await page
    .getByRole("button", { name: "Refresh Forms", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue(
    "Keep this original local note",
  );
  await page
    .getByRole("button", { name: "Save progress", exact: true })
    .click();
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
  expect(model.posts()).toHaveLength(2);
});
for (const code of [401, 403])
  test(`current ${code} clears private answers and capabilities`, async ({
    page,
  }) => {
    await openForm(page);
    model.hook = (call) =>
      call.method === "POST" ? { status: code } : undefined;
    await page.getByLabel("Shift notes").fill("Private note must clear");
    await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
      "Private data has been cleared",
    );
    await expect(page.getByLabel("Shift notes")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Send response", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!),
        markerKey,
      ),
    ).toEqual({
      operationId: model.posts()[0].body!.operationId,
      action: "save_progress",
    });
  });
test("unknown save keeps only action UUID and signed receipt recovery loads current answers", async ({
  page,
}) => {
  await openForm(page);
  let once = true;
  model.hook = (call) => {
    if (call.body?.change?.action === "save_progress" && once) {
      once = false;
      model.apply(call.body.change, call.body.operationId);
      return { abort: true };
    }
  };
  await page
    .getByLabel("Shift notes")
    .fill("Private answer no browser persistence");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  const stored = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    markerKey,
  );
  expect(stored).not.toContain("Private answer");
  expect(Object.keys(JSON.parse(stored!)).sort()).toEqual([
    "action",
    "operationId",
  ]);
  await page
    .getByRole("button", { name: "Recover Forms", exact: true })
    .click();
  await expect(
    page.getByText(
      "The operation was recorded. Current data has been refreshed.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Shift notes")).toHaveValue(
    "Private answer no browser persistence",
  );
  expect(model.posts()).toHaveLength(1);
});
test("definitive absence permits new explicitly initiated operation without replaying discarded bytes", async ({
  page,
}) => {
  await openForm(page);
  let once = true;
  model.hook = (call) => {
    if (call.body?.change?.action === "save_progress" && once) {
      once = false;
      return { abort: true };
    }
  };
  await page.getByLabel("Shift notes").fill("Unknown unrecorded");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Recover Forms", exact: true })
    .click();
  await expect(
    page.getByText(
      "The operation was not recorded. Current access has been refreshed; you can start a new action.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(model.posts()).toHaveLength(1);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBeNull();
});
test("missing acknowledgment locks and forced refresh cannot replace uncertain operation", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) => (call.method === "POST" ? { data: {} } : undefined);
  await page.getByLabel("Shift notes").fill("Unknown acknowledgment");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  const before = model.calls.length;
  await forceClick(page, "Refresh Forms");
  await forceClick(page, "Save progress");
  expect(model.calls).toHaveLength(before);
  expect(model.posts()).toHaveLength(1);
});
test("held decoded acknowledgment preserves guard even when disabled React handler is invoked", async ({
  page,
}) => {
  await openForm(page);
  await holdAcknowledgment(page);
  await page.getByLabel("Shift notes").fill("Held durable save");
  await waitAcknowledgment(page);
  const before = model.calls.length,
    marker = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      markerKey,
    );
  await forceClick(page, "Refresh Forms");
  await forceClick(page, "Save progress");
  await forceClick(page, "Manage forms");
  expect(model.calls).toHaveLength(before);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBe(marker);
  await expect(page.getByLabel("Shift notes")).toHaveValue("Held durable save");
  await releaseAcknowledgment(page);
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
});
for (const departure of [
  "Toggle synthetic departure",
  "Switch synthetic actor",
  "Switch synthetic company",
  "Switch synthetic role",
])
  test(`held decoded save cannot restore old private state after ${departure}`, async ({
    page,
  }) => {
    await openForm(page);
    await holdAcknowledgment(page);
    await page.getByLabel("Shift notes").fill("Old actor private answer");
    await waitAcknowledgment(page);
    await page.getByRole("button", { name: departure, exact: true }).click();
    await expect(page.getByLabel("Shift notes")).toHaveCount(0);
    await releaseAcknowledgment(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByText("Progress saved.", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Shift notes")).toHaveCount(0);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
    ).not.toBeNull();
  });
test("held detail body from prior actor cannot restore respondent fields", async ({
  page,
}) => {
  const held = deferred();
  model.hook = async (call) => {
    if (call.url.pathname === `/api/forms/${f.formId}`) {
      const data = model.detail(f.formId, "mine");
      await held.promise;
      return { data };
    }
  };
  await page
    .getByRole("button", { name: "Open form Daily readiness", exact: true })
    .click();
  await expect.poll(() => model.calls.length).toBe(1);
  await page
    .getByRole("button", { name: "Switch synthetic actor", exact: true })
    .click();
  held.resolve();
  await expect(page.getByLabel("Shift notes")).toHaveCount(0);
});
test("foreign signed DTO fails closed", async ({ page }) => {
  model.hook = (call) =>
    call.url.pathname === `/api/forms/${f.formId}`
      ? { data: { ...model.detail(f.formId, "mine"), actorId: f.otherActor } }
      : undefined;
  await page
    .getByRole("button", { name: "Open form Daily readiness", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "could not be verified",
  );
  await expect(page.getByLabel("Shift notes")).toHaveCount(0);
});
test("builder keeps ordered stable question and option UUIDs", async ({
  page,
}) => {
  await manage(page);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await page.getByLabel("Form name", { exact: true }).fill("New inspection");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page.getByLabel("Question label 1", { exact: true }).fill("Notes");
  await page
    .getByRole("button", { name: "Add single choice", exact: true })
    .click();
  await page.getByLabel("Question label 2", { exact: true }).fill("Place");
  await page.getByLabel("Option 2.1", { exact: true }).fill("Workshop");
  await page
    .getByRole("button", { name: "Move question 2 up", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save draft form", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "New inspection", exact: true }),
  ).toBeVisible();
  const change = model.posts()[0].body!.change;
  expect(change.action).toBe("create_form");
  if (change.action === "create_form") {
    expect(change.schema.map((field) => field.kind)).toEqual([
      "single_choice",
      "text",
    ]);
    expect(new Set(change.schema.map((field) => field.id)).size).toBe(2);
  }
});
test("searched eligible roster beyond first thousand preserves selected users across search", async ({
  page,
}) => {
  await manage(page);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await page
    .getByLabel("Search eligible people", { exact: true })
    .fill("Example Person 1005");
  await page
    .getByRole("button", { name: "Search people", exact: true })
    .click();
  await page.getByLabel("Example Person 1005", { exact: true }).check();
  await page
    .getByLabel("Search eligible people", { exact: true })
    .fill("Example Person 0001");
  await page
    .getByRole("button", { name: "Search people", exact: true })
    .click();
  await page.getByLabel("Example Person 0001", { exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Assigned people · 2/500", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Remove assigned person Example Person 1005",
      exact: true,
    }),
  ).toBeVisible();
});
test("published questions are fixed while metadata remains editable", async ({
  page,
}) => {
  await manage(page);
  await openForm(page);
  await page.getByRole("button", { name: "Edit form", exact: true }).click();
  await expect(
    page.getByLabel("Question label 2", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add text", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Form name", { exact: true }).fill("Renamed readiness");
  await page
    .getByRole("button", { name: "Save form changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Renamed readiness", exact: true }),
  ).toBeVisible();
  const change = model.posts()[0].body!.change;
  expect(change.action === "edit_form" && change.schema).toEqual(f.schema);
});
test("management excludes private progress from submitted lists", async ({
  page,
}) => {
  await openForm(page);
  await page.getByLabel("Shift notes").fill("Private incomplete");
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to forms", exact: true })
    .click();
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await expect(
    page.getByText("No responses match this filter.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Private incomplete", { exact: true }),
  ).toHaveCount(0);
});
test("administrator answer edit retains attributed history and review is explicit", async ({
  page,
}) => {
  model.submitted();
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  expect(model.posts()).toHaveLength(0);
  await page
    .getByRole("button", { name: "Edit submitted answers", exact: true })
    .click();
  await page
    .getByLabel("Shift notes", { exact: true })
    .fill("Reviewed correction");
  await page
    .getByRole("button", { name: "Save edited answers", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retained history · 1", exact: true }),
  ).toBeVisible();
  expect(model.posts()[0].body!.change.action).toBe("admin_edit_response");
  expect(model.history[0].answers[f.fieldId(2)]).toBe("Safe team");
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(
    page.getByText("Reviewed by Example Owner", { exact: true }),
  ).toBeVisible();
  expect(model.posts()[1].body!.change.action).toBe("review_response");
});
test("respondent edit preserves first submission time and records immutable prior content", async ({
  page,
}) => {
  model.submitted();
  await openForm(page);
  await page
    .getByRole("button", { name: "Edit my response", exact: true })
    .click();
  await page.getByLabel("Shift notes", { exact: true }).fill("Own correction");
  await page
    .getByRole("button", { name: "Save edited answers", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue("Own correction");
  expect(model.posts()[0].body!.change.action).toBe("edit_response");
  expect(model.response?.submittedAt).toBe(f.instant);
  expect(model.history).toHaveLength(1);
});
test("archived submitted detail stays readable but no editing or review controls", async ({
  page,
}) => {
  model.submitted();
  model.forms[0].status = "archived";
  model.response!.canEdit = false;
  model.response!.canReview = false;
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue("Safe team");
  await expect(
    page.getByRole("button", { name: "Edit submitted answers", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark reviewed", exact: true }),
  ).toHaveCount(0);
});

test("employee has only assigned respondent controls", async ({ page }) => {
  await page
    .getByRole("button", { name: "Switch synthetic role", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Manage forms", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create form", exact: true }),
  ).toHaveCount(0);
});
test("management respondent assignment remains required even for an owner", async ({
  page,
}) => {
  model.audiences.set(f.formId, []);
  await manage(page);
  await openForm(page);
  await page.getByRole("button", { name: "My forms", exact: true }).click();
  await expect(
    page.getByText("No forms match this view.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send response", exact: true }),
  ).toHaveCount(0);
});
test("forged unassigned respondent detail cannot restore fields", async ({
  page,
}) => {
  model.audiences.set(f.formId, []);
  await page
    .getByRole("button", { name: "Open form Daily readiness", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "could not be verified",
  );
  await expect(page.getByLabel("Shift notes")).toHaveCount(0);
});
test("explicit No is a real required answer", async ({ page }) => {
  await openForm(page);
  await complete(page);
  await page.getByLabel("No", { exact: true }).check();
  await page
    .getByRole("button", { name: "Send response", exact: true })
    .click();
  await expect(
    page.getByText("Your response was submitted.", { exact: true }),
  ).toBeVisible();
  expect(model.response?.answers[f.fieldId(3)]).toBe(false);
});
test("Send while a save is in flight waits for its durable revision", async ({
  page,
}) => {
  await openForm(page);
  await complete(page);
  const held = deferred();
  let first = true;
  model.hook = async (call) => {
    if (call.body?.change?.action === "save_progress" && first) {
      first = false;
      const saved = model.apply(call.body.change, call.body.operationId);
      await held.promise;
      return { data: { saved } };
    }
  };
  await page
    .getByRole("button", { name: "Save progress", exact: true })
    .click();
  await expect.poll(() => model.posts().length).toBe(1);
  await page
    .getByRole("button", { name: "Send response", exact: true })
    .click();
  expect(model.posts()).toHaveLength(1);
  held.resolve();
  await expect(
    page.getByText("Your response was submitted.", { exact: true }),
  ).toBeVisible();
  const submit = model.posts()[1].body!.change;
  expect(submit.action).toBe("submit_response");
  expect("responseRevision" in submit && submit.responseRevision).toBe(1);
});
test("unknown recovery denial retains exact marker and clears all private content", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) =>
    call.url.pathname === "/api/forms/reconcile"
      ? { status: 403 }
      : call.body?.change?.action === "save_progress"
        ? { abort: true }
        : undefined;
  await page.getByLabel("Shift notes").fill("Private unknown");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  const original = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    markerKey,
  );
  await page
    .getByRole("button", { name: "Recover Forms", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveCount(0);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBe(original);
  expect(model.posts()).toHaveLength(1);
});
test("wrong actor save acknowledgment stays uncertain without clearing original marker", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) =>
    call.body?.change?.action === "save_progress"
      ? {
          data: {
            saved: {
              ...model.apply(call.body.change, call.body.operationId),
              actorId: f.otherActor,
            },
          },
        }
      : undefined;
  await page.getByLabel("Shift notes").fill("Keep unknown original actor");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Progress saved.", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).not.toBeNull();
});
test("held POST before headers blocks actual refresh and management closures", async ({
  page,
}) => {
  await openForm(page);
  const held = deferred();
  model.hook = async (call) => {
    if (call.body?.change?.action === "save_progress") {
      await held.promise;
      return {
        data: { saved: model.apply(call.body.change, call.body.operationId) },
      };
    }
  };
  await page.getByLabel("Shift notes").fill("Pending transport");
  await expect.poll(() => model.posts().length).toBe(1);
  const before = model.calls.length;
  await forceClick(page, "Refresh Forms");
  await forceClick(page, "Manage forms");
  expect(model.calls).toHaveLength(before);
  held.resolve();
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
});
test("locked submitted editing exposes no edit action", async ({ page }) => {
  model.submitted();
  model.forms[0].allowRespondentEdit = false;
  await openForm(page);
  await expect(page.getByLabel("Shift notes")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit my response", exact: true }),
  ).toHaveCount(0);
});
test("current response denial clears respondent and management panes", async ({
  page,
}) => {
  model.submitted();
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  model.hook = (call) =>
    call.url.pathname.endsWith(`/responses/${f.responseId}`)
      ? { status: 403 }
      : undefined;
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Form submissions" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View submissions", exact: true }),
  ).toHaveCount(0);
});
test("malformed private-progress management detail fails closed", async ({
  page,
}) => {
  model.submitted();
  model.response!.status = "in_progress";
  await manage(page);
  await openForm(page);
  model.hook = (call) =>
    call.url.pathname.endsWith(`/responses/${f.responseId}`)
      ? {
          data: {
            ...model.identity(),
            form: model.scopedForm(f.formId, "manage"),
            response: model.response,
            history: [],
            historyCount: 0,
            collectionVersion: "1",
            nextCursor: null,
            serverTime: f.instant,
          },
        }
      : undefined;
  // The malicious detail is requested through a submitted list, not via browser-side filtering.
  model.response!.status = "submitted";
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  model.response!.status = "in_progress";
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "could not be verified",
  );
  await expect(page.getByLabel("Shift notes")).toHaveCount(0);
});
test("response conflict retains admin local answers through current exact-response refresh", async ({
  page,
}) => {
  model.submitted();
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit submitted answers", exact: true })
    .click();
  await page.getByLabel("Shift notes").fill("Retained correction");
  let first = true;
  model.hook = (call) => {
    if (call.body?.change?.action === "admin_edit_response" && first) {
      first = false;
      model.response!.revision++;
      return { status: 409 };
    }
  };
  await page
    .getByRole("button", { name: "Save edited answers", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "local answers are retained",
  );
  await page
    .getByRole("button", { name: "Refresh Forms", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue(
    "Retained correction",
  );
  await page
    .getByRole("button", { name: "Save edited answers", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retained history · 1", exact: true }),
  ).toBeVisible();
});
test("literal title search transports percent and underscore unchanged", async ({
  page,
}) => {
  await manage(page);
  await page.getByLabel("Search form titles", { exact: true }).fill("%_Daily");
  await page.getByRole("button", { name: "Search forms", exact: true }).click();
  await expect(
    page.getByText("No forms match this view.", { exact: true }),
  ).toBeVisible();
  expect(model.calls.at(-1)?.url.searchParams.get("search")).toBe("%_Daily");
});
test("roster pagination retains previously selected original Auth UUIDs", async ({
  page,
}) => {
  await manage(page);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await page
    .getByRole("button", { name: "Search people", exact: true })
    .click();
  await page.getByLabel("Example Person 0001", { exact: true }).check();
  await page
    .getByRole("button", { name: "Load more people", exact: true })
    .click();
  await page.getByLabel("Example Person 0050", { exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Assigned people · 2/500", exact: true }),
  ).toBeVisible();
});
test("history uses bounded ten-entry pages and shared frozen schema", async ({
  page,
}) => {
  model.submitted();
  model.history = Array.from({ length: 23 }, (_, index) => ({
    ...model.response!,
    id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
    responseId: f.responseId,
    revision: index + 1,
    retainedAt: f.instant,
  }));
  model.hook = (call) => {
    if (call.url.pathname.endsWith(`/responses/${f.responseId}`)) {
      const offset = Number(call.url.searchParams.get("cursor") ?? "0");
      return {
        data: {
          ...model.identity(),
          form: model.scopedForm(f.formId, "manage"),
          response: model.response,
          history: model.history.slice(offset, offset + 10),
          historyCount: 23,
          collectionVersion: "9007199254740993",
          nextCursor: offset + 10 < 23 ? String(offset + 10) : null,
          serverTime: f.instant,
        },
      };
    }
  };
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await expect(page.locator(".forms-history details")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Load more history", exact: true })
    .click();
  await expect(page.locator(".forms-history details")).toHaveCount(20);
  await page
    .getByRole("button", { name: "Load more history", exact: true })
    .click();
  await expect(page.locator(".forms-history details")).toHaveCount(23);
  expect(
    model.calls
      .filter((call) =>
        call.url.pathname.endsWith(`/responses/${f.responseId}`),
      )
      .every((call) => call.url.searchParams.get("limit") === "10"),
  ).toBe(true);
});
test("held history page cannot restore a closed submission pane", async ({
  page,
}) => {
  model.submitted();
  const held = deferred();
  model.hook = async (call) => {
    if (call.url.pathname.endsWith(`/responses/${f.responseId}`)) {
      const data = {
        ...model.identity(),
        form: model.scopedForm(f.formId, "manage"),
        response: model.response,
        history: [],
        historyCount: 0,
        collectionVersion: "1",
        nextCursor: null,
        serverTime: f.instant,
      };
      await held.promise;
      return { data };
    }
  };
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  held.resolve();
  await expect(
    page.getByRole("region", { name: "Submission detail", exact: true }),
  ).toHaveCount(0);
});

test("autosave resumes after correcting an invalid numeric draft", async ({
  page,
}) => {
  await openForm(page);
  await page.getByLabel("Meter reading").fill("1e3");
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "decimal number",
  );
  await page.getByLabel("Meter reading").fill("1000.25");
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
  expect(model.response?.answers[f.fieldId(6)]).toBe("1000.25");
});
test("wrong revision acknowledgment cannot become a durable saved state", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) =>
    call.body?.change?.action === "save_progress"
      ? {
          data: {
            saved: {
              ...model.apply(call.body.change, call.body.operationId),
              responseRevision: 17,
            },
          },
        }
      : undefined;
  await page.getByLabel("Shift notes").fill("No trusted revision");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Progress saved.", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).not.toBeNull();
});
test("respondent can explicitly discard an unsent edit without writing", async ({
  page,
}) => {
  model.submitted();
  await openForm(page);
  await page
    .getByRole("button", { name: "Edit my response", exact: true })
    .click();
  await page.getByLabel("Shift notes").fill("Discarded local edit");
  await page
    .getByRole("button", { name: "Cancel answer editing", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue("Safe team");
  expect(model.posts()).toHaveLength(0);
});
test("administrator can explicitly discard an unsent edit without changing review", async ({
  page,
}) => {
  model.submitted();
  model.response!.reviewed = true;
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit submitted answers", exact: true })
    .click();
  await page.getByLabel("Shift notes").fill("Discarded admin edit");
  await page
    .getByRole("button", { name: "Cancel answer editing", exact: true })
    .click();
  await expect(page.getByLabel("Shift notes")).toHaveValue("Safe team");
  expect(model.response!.reviewed).toBe(true);
  expect(model.posts()).toHaveLength(0);
});
test("review update time is not displayed as an answer editor action time", async ({
  page,
}) => {
  model.submitted();
  model.response!.lastEditedAt = "2026-10-01T08:30:00.000000+00:00";
  model.response!.updatedAt = "2026-10-04T15:45:00.000000+00:00";
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "View submissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open response Example Owner", exact: true })
    .click();
  await expect(
    page.getByText("Last edited by Example Owner · 1 Oct 2026, 08:30 UTC", {
      exact: true,
    }),
  ).toBeVisible();
});
test("combined answer byte bound is checked before any outbound save", async ({
  page,
}) => {
  const extra = Array.from({ length: 14 }, (_, index) => ({
    id: f.fieldId(index + 7),
    kind: "text" as const,
    label: `Long note ${index + 1}`,
    required: false,
  }));
  model.schema.push(...extra);
  await openForm(page);
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLTextAreaElement>(
        'textarea[aria-label^="Long note "]',
      )
      .forEach((element) => {
        const key = Object.keys(element).find((value) =>
          value.startsWith("__reactProps$"),
        )!;
        const props = (
          element as unknown as Record<
            string,
            { onChange: (event: { target: { value: string } }) => void }
          >
        )[key];
        props.onChange({ target: { value: "x".repeat(5000) } });
      });
  });
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "64 KiB",
  );
  expect(model.posts()).toHaveLength(0);
});
test("five hundred selected users remain bounded even when disabled checkbox handler is invoked", async ({
  page,
}) => {
  model.audiences.set(
    f.formId,
    model.roster.slice(0, 500).map((user) => user.actorId),
  );
  await manage(page);
  await openForm(page);
  await page
    .getByRole("button", { name: "Assign people", exact: true })
    .click();
  await page
    .getByLabel("Search eligible people", { exact: true })
    .fill("Example Person 1005");
  await page
    .getByRole("button", { name: "Search people", exact: true })
    .click();
  const box = page.getByLabel("Example Person 1005", { exact: true });
  await expect(box).toBeDisabled();
  await box.evaluate((element) => {
    const key = Object.keys(element).find((value) =>
      value.startsWith("__reactProps$"),
    )!;
    (
      element as unknown as Record<
        string,
        { onChange: (event: { target: { checked: boolean } }) => void }
      >
    )[key].onChange({ target: { checked: true } });
  });
  await expect(
    page.getByRole("heading", {
      name: "Assigned people · 500/500",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save assignments", exact: true })
    .click();
  const change = model.posts()[0].body!.change;
  expect(change.action === "set_audience" && change.audienceIds.length).toBe(
    500,
  );
});
test("malformed schema fails closed before rendering answer controls", async ({
  page,
}) => {
  model.hook = (call) =>
    call.url.pathname === `/api/forms/${f.formId}`
      ? {
          data: {
            ...model.detail(f.formId, "mine"),
            schema: [
              {
                id: f.fieldId(1),
                kind: "unexpected",
                label: "Private forged field",
                required: false,
              },
            ],
          },
        }
      : undefined;
  await page
    .getByRole("button", { name: "Open form Daily readiness", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "could not be verified",
  );
  await expect(page.getByLabel("Shift notes")).toHaveCount(0);
});

test("a mutation invalidates a held roster response before an uncertain acknowledgment", async ({
  page,
}) => {
  await manage(page);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await page.getByLabel("Form name", { exact: true }).fill("Pending form");
  const held = deferred();
  model.hook = async (call) => {
    if (call.url.pathname === "/api/forms/roster") {
      await held.promise;
      return {
        data: {
          ...model.identity(),
          users: [
            {
              actorId: f.otherActor,
              name: "Old private roster name",
              eligible: true,
            },
          ],
          matchedCount: 1,
          rosterVersion: "1",
          nextCursor: null,
          serverTime: f.instant,
        },
      };
    }
    if (call.body?.change?.action === "create_form") return { abort: true };
  };
  await page
    .getByRole("button", { name: "Search people", exact: true })
    .click();
  await expect
    .poll(
      () =>
        model.calls.filter((call) => call.url.pathname === "/api/forms/roster")
          .length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Save draft form", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  held.resolve();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByText("Old private roster name", { exact: true }),
  ).toHaveCount(0);
});

for (const allowEdit of [true, false])
  test(`concurrent submission permits deliberate local discard with respondent editing ${allowEdit}`, async ({
    page,
  }) => {
    await openForm(page);
    let first = true;
    model.hook = (call) => {
      if (call.body?.change?.action === "save_progress" && first) {
        first = false;
        model.submitted();
        model.response!.revision = 2;
        model.forms[0].allowRespondentEdit = allowEdit;
        return { status: 409 };
      }
    };
    await page
      .getByLabel("Shift notes")
      .fill("Retain my unsaved original note");
    await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
      "local answers are retained",
    );
    await page
      .getByRole("button", { name: "Refresh Forms", exact: true })
      .click();
    await expect(page.getByLabel("Shift notes")).toHaveValue(
      "Retain my unsaved original note",
    );
    await expect(
      page.getByRole("button", { name: "Save progress", exact: true }),
    ).toHaveCount(0);
    if (allowEdit) {
      await forceClick(page, "Edit my response");
      await expect(
        page.getByRole("button", { name: "Save edited answers", exact: true }),
      ).toHaveCount(0);
    }
    await forceClick(page, "Discard unsaved answers");
    await expect(page.getByLabel("Shift notes")).toHaveValue("Safe team");
    await expect(
      page.getByRole("button", {
        name: "Discard unsaved answers",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(model.posts()).toHaveLength(1);
    if (allowEdit) {
      await page
        .getByRole("button", { name: "Edit my response", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Save edited answers", exact: true }),
      ).toBeEnabled();
    } else {
      await page
        .getByRole("button", { name: "Back to forms", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Assigned forms", exact: true }),
      ).toBeVisible();
    }
  });
test("held acknowledgment refuses the actual discard closure and preserves marker", async ({
  page,
}) => {
  await openForm(page);
  await holdAcknowledgment(page);
  await page.getByLabel("Shift notes").fill("Held unsaved note");
  await waitAcknowledgment(page);
  const before = model.calls.length,
    marker = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      markerKey,
    );
  await forceClick(page, "Discard unsaved answers");
  expect(model.calls).toHaveLength(before);
  await expect(page.getByLabel("Shift notes")).toHaveValue("Held unsaved note");
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBe(marker);
  await releaseAcknowledgment(page);
  await expect(
    page.getByText("Progress saved.", { exact: true }),
  ).toBeVisible();
});
test("uncertain save refuses actual discard closure without losing recovery UUID", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) =>
    call.body?.change?.action === "save_progress" ? { data: {} } : undefined;
  await page.getByLabel("Shift notes").fill("Unknown retained note");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  const before = model.calls.length,
    marker = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      markerKey,
    );
  await forceClick(page, "Discard unsaved answers");
  expect(model.calls).toHaveLength(before);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBe(marker);
  await expect(page.getByLabel("Shift notes")).toHaveValue(
    "Unknown retained note",
  );
});
test("progress acknowledgment cannot claim submitted status", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) =>
    call.body?.change?.action === "save_progress"
      ? {
          data: {
            saved: {
              ...model.apply(call.body.change, call.body.operationId),
              responseStatus: "submitted",
            },
          },
        }
      : undefined;
  await page.getByLabel("Shift notes").fill("Invalid receipt status");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Progress saved.", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).not.toBeNull();
});
test("submission acknowledgment cannot claim in-progress status", async ({
  page,
}) => {
  await openForm(page);
  model.hook = (call) =>
    call.body?.change?.action === "submit_response"
      ? {
          data: {
            saved: {
              ...model.apply(call.body.change, call.body.operationId),
              responseStatus: "in_progress",
            },
          },
        }
      : undefined;
  await complete(page);
  await page
    .getByRole("button", { name: "Send response", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Your response was submitted.", { exact: true }),
  ).toHaveCount(0);
  expect(
    JSON.parse(
      (await page.evaluate((key) => sessionStorage.getItem(key), markerKey))!,
    ).action,
  ).toBe("submit_response");
});
test("known own response acknowledgment cannot replace its identity", async ({
  page,
}) => {
  model.submitted();
  model.response!.status = "in_progress";
  model.response!.submittedAt = null;
  await openForm(page);
  model.hook = (call) =>
    call.body?.change?.action === "save_progress"
      ? {
          data: {
            saved: {
              ...model.apply(call.body.change, call.body.operationId),
              responseId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
            },
          },
        }
      : undefined;
  await page.getByLabel("Shift notes").fill("Original response only");
  await expect(
    page.getByRole("button", { name: "Recover Forms", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Progress saved.", { exact: true })).toHaveCount(
    0,
  );
});
for (const action of ["admin_edit_response", "review_response"] as const)
  test(`${action} acknowledgment is bound to its exact response`, async ({
    page,
  }) => {
    model.submitted();
    await manage(page);
    await openForm(page);
    await page
      .getByRole("button", { name: "View submissions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open response Example Owner", exact: true })
      .click();
    model.hook = (call) =>
      call.body?.change?.action === action
        ? {
            data: {
              saved: {
                ...model.apply(call.body.change, call.body.operationId),
                responseId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
              },
            },
          }
        : undefined;
    if (action === "admin_edit_response") {
      await page
        .getByRole("button", { name: "Edit submitted answers", exact: true })
        .click();
      await page
        .getByLabel("Shift notes")
        .fill("Bound administrator correction");
      await page
        .getByRole("button", { name: "Save edited answers", exact: true })
        .click();
    } else
      await page
        .getByRole("button", { name: "Mark reviewed", exact: true })
        .click();
    await expect(
      page.getByRole("button", { name: "Recover Forms", exact: true }),
    ).toBeEnabled();
    expect(
      model.calls.some((call) =>
        call.url.pathname.endsWith(
          "/responses/dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        ),
      ),
    ).toBe(false);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
    ).not.toBeNull();
    await expect(page.getByText("Forms updated.", { exact: true })).toHaveCount(
      0,
    );
  });

for (const required of [false, true])
  test(`cleared numeric input omits its answer through the actual attached handler, required ${required}`, async ({
    page,
  }) => {
    const number = model.schema.find((field) => field.kind === "number")!;
    if (number.kind === "description")
      throw new Error("Numeric fixture missing");
    number.required = required;
    await openForm(page);
    await complete(page);
    await page
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    await expect(
      page.getByText("Progress saved.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Meter reading", { exact: true })
      .evaluate((element) => {
        const key = Object.keys(element).find((value) =>
          value.startsWith("__reactProps$"),
        )!;
        (element as HTMLInputElement).disabled = true;
        (
          element as unknown as Record<
            string,
            { onChange: (event: { target: { value: string } }) => void }
          >
        )[key].onChange({ target: { value: "" } });
      });
    await page
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    await expect.poll(() => model.posts().length).toBe(2);
    const progress = model.posts()[1].body!.change;
    expect(
      "answers" in progress && Object.hasOwn(progress.answers, f.fieldId(6)),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Send response", exact: true })
      .click();
    if (required) {
      await expect(
        page.locator(".forms-page").getByRole("alert"),
      ).toContainText("Complete Meter reading");
      expect(
        model
          .posts()
          .some((call) => call.body?.change?.action === "submit_response"),
      ).toBe(false);
    } else {
      await expect(
        page.getByText("Your response was submitted.", { exact: true }),
      ).toBeVisible();
      const submit = model.posts().at(-1)!.body!.change;
      expect(submit.action).toBe("submit_response");
      expect(
        "answers" in submit && Object.hasOwn(submit.answers, f.fieldId(6)),
      ).toBe(false);
    }
    expect(
      model.schema.find((field) => field.id === f.fieldId(6))?.kind ===
        "number" && number.required,
    ).toBe(required);
  });
test("whitespace-only required text is saved exactly as partial progress but cannot submit", async ({
  page,
}) => {
  await openForm(page);
  await complete(page);
  const whitespace = " \t\n\u2003 ";
  await page
    .getByLabel("Shift notes", { exact: true })
    .evaluate((element, value) => {
      const key = Object.keys(element).find((name) =>
        name.startsWith("__reactProps$"),
      )!;
      (
        element as unknown as Record<
          string,
          { onChange: (event: { target: { value: string } }) => void }
        >
      )[key].onChange({ target: { value } });
    }, whitespace);
  await page
    .getByRole("button", { name: "Send response", exact: true })
    .click();
  await expect(page.locator(".forms-page").getByRole("alert")).toContainText(
    "Complete Shift notes",
  );
  expect(
    model
      .posts()
      .some((call) => call.body?.change?.action === "submit_response"),
  ).toBe(false);
  expect(model.response?.answers[f.fieldId(2)]).toBe(whitespace);
});
