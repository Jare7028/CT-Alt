import { test, expect, type Page } from "@playwright/test";
import {
  FileModel,
  openFile,
  fileId,
  fileVersion,
  blobBarrier,
} from "./file-helpers";
import {
  openSection,
  deferred,
  forceClick,
  bodyBarrier,
  waitBody,
  releaseBody,
  markerKey,
  assertCleared,
  manager,
} from "./helpers";
import * as f from "./fixture-data";
import { KNOWLEDGE_FILE_HEADERS } from "../../lib/knowledge-base-file-types";
let model: FileModel;
test.beforeEach(async ({ page }) => {
  model = new FileModel(page);
  await model.install();
});
async function editor(page: Page, replace = false) {
  if (replace) {
    await openFile(page);
    await page
      .getByRole("button", { name: "Edit resource", exact: true })
      .click();
  } else {
    await openSection(page);
    await page.getByRole("button", { name: "Add file", exact: true }).click();
  }
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel("Resource name", { exact: true })
    .fill("Synthetic attached guide");
}
async function choose(
  page: Page,
  name = "guide.txt",
  mimeType = "text/plain",
  buffer = Buffer.from("Synthetic original file\n"),
) {
  await page
    .getByLabel("Choose file", { exact: true })
    .setInputFiles({ name, mimeType, buffer });
}
async function submit(page: Page, replace = false) {
  await page
    .getByRole("button", {
      name: replace ? "Replace file" : "Save file",
      exact: true,
    })
    .click();
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: "File saved." }),
  ).toBeVisible();
}
function posts() {
  return model.fileCalls.filter(
    (c) =>
      c.method === "POST" &&
      new RegExp(`/knowledge-base/${f.bookId}/files$`).test(c.path),
  );
}
test("file detail is an attachment with truthful metadata and no fake preview", async ({
  page,
}) => {
  await openFile(page);
  await expect(
    page.getByRole("region", { name: "Current file" }),
  ).toContainText("field-safety.txt");
  await expect(page.locator("iframe,img.kb-preview,object,embed")).toHaveCount(
    0,
  );
  expect(model.writes("view")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Download current file", exact: true }),
  ).toBeEnabled();
});
test("create uploads one strict bounded multipart and displays freshly read finalized version", async ({
  page,
}) => {
  await editor(page);
  await choose(page);
  await submit(page);
  await saved(page);
  expect(posts()).toHaveLength(1);
  const metadata = model.uploads[0];
  expect(metadata).toMatchObject({
    tenantId: f.company.id,
    baseId: f.bookId,
    mode: "create",
    parentId: f.sectionId,
    expectedBaseRevision: 1,
    name: "Synthetic attached guide",
    filename: "guide.txt",
  });
  expect(Object.keys(metadata).sort()).toEqual(
    [
      "baseId",
      "description",
      "expectedBaseRevision",
      "filename",
      "mode",
      "name",
      "operationId",
      "parentId",
      "tenantId",
    ].sort(),
  );
  expect(posts()[0].raw!.toString()).toContain("Synthetic original file");
  await expect(
    page.getByRole("region", { name: "Current file" }),
  ).toContainText("guide.txt");
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBeNull();
});
test("replacement retains old current version until acknowledgement and binds original revisions", async ({
  page,
}) => {
  const hold = deferred();
  model.fileHook = async (call) => {
    if (call.path === `/api/knowledge-base/${f.bookId}/files`) {
      await hold.promise;
    }
  };
  await editor(page, true);
  await choose(page, "replacement.txt");
  await submit(page, true);
  await expect.poll(() => posts().length).toBe(1);
  await expect(
    page.getByRole("region", { name: "Current file" }),
  ).toContainText("field-safety.txt");
  expect(model.nodes.find((n) => n.id === fileId)!.currentFile!.versionId).toBe(
    fileVersion,
  );
  await forceClick(page, "Refresh Knowledge Base");
  expect(posts()).toHaveLength(1);
  hold.resolve();
  await saved(page);
  expect(model.uploads[0]).toMatchObject({
    mode: "replace",
    nodeId: fileId,
    expectedNodeRevision: 1,
  });
  await expect(
    page.getByRole("region", { name: "Current file" }),
  ).toContainText("replacement.txt");
});
for (const [name, mime, bytes, message] of [
  ["empty.txt", "text/plain", 0, "nonempty"],
  ["large.txt", "text/plain", 2097153, "2 MiB"],
  ["bad.docx", "application/octet-stream", 10, "PDF"],
  ["fake.png", "text/plain", 10, "must agree"],
] as const) {
  test(`file validation prevents request: ${name}`, async ({ page }) => {
    await editor(page);
    await choose(page, name, mime, Buffer.alloc(bytes, 65));
    await expect(
      page.getByRole("alert").filter({ hasText: message }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save file", exact: true }),
    ).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });
}
for (const [name, mime] of [
  ["document.pdf", "application/pdf"],
  ["notes.txt", ""],
  ["sheet.csv", "application/vnd.ms-excel"],
  ["photo.png", "image/png"],
  ["photo.jpeg", "image/jpeg"],
  ["binary.txt", "application/octet-stream"],
] as const) {
  test(`supported picker type reaches server verification: ${name}/${mime || "empty"}`, async ({
    page,
  }) => {
    await editor(page);
    await choose(page, name, mime);
    await expect(
      page.getByRole("button", { name: "Save file", exact: true }),
    ).toBeEnabled();
    await submit(page);
    await saved(page);
    expect(posts()).toHaveLength(1);
  });
}
test("exact 2 MiB is accepted without multiplying reservations", async ({
  page,
}) => {
  await editor(page);
  await choose(page, "maximum.txt", "text/plain", Buffer.alloc(2097152, 65));
  await submit(page);
  await saved(page);
  expect(posts()).toHaveLength(1);
});
test("budget reads remain tenant scoped without an ordinary allocation panel", async ({
  page,
}) => {
  await editor(page);
  const budget = page.getByRole("region", {
    name: "Reserved and retained budget",
  });
  await expect(budget).toHaveCount(0);
  await expect.poll(() => model.fileCalls.filter((c) => c.path.endsWith("/budget")).length).toBe(1);
  expect(
    model.fileCalls
      .filter((c) => c.path.endsWith("/budget"))[0]
      .url.searchParams.toString(),
  ).toBe(`tenantId=${f.company.id}`);
});
test("unknown upload persists only actor/company UUID marker and never resends bytes on recovery", async ({
  page,
}) => {
  model.fileHook = (call) => {
    if (call.path === `/api/knowledge-base/${f.bookId}/files`) {
      model.attempt = model.pending(String(call.body!.operationId));
      return { abort: true };
    }
  };
  await editor(page);
  await choose(page, "private-name.txt");
  await submit(page);
  await assertCleared(page);
  const marker = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    markerKey,
  );
  expect(Object.keys(marker).sort()).toEqual(["action", "operationId"]);
  expect(marker.action).toBe("save_file");
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Permanently close file operation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Verify and finalize original file",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(posts()).toHaveLength(1);
  const reconcile = model.fileCalls.find((c) => c.path.endsWith("/reconcile"))!;
  expect(reconcile.body).toEqual({
    tenantId: f.company.id,
    operationId: marker.operationId,
  });
  await page
    .getByRole("button", {
      name: "Permanently close file operation",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "File operation closed." }),
  ).toBeVisible();
  expect(posts()).toHaveLength(1);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
  ).toBeNull();
});
test("durable provider success can finalize original upload without another outbound upload", async ({
  page,
}) => {
  model.fileHook = (call) => {
    if (call.path === `/api/knowledge-base/${f.bookId}/files`) {
      model.attempt = model.pending(
        String(call.body!.operationId),
        "provider_succeeded",
      );
      return { abort: true };
    }
  };
  await editor(page);
  await choose(page);
  await submit(page);
  await assertCleared(page);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Verify and finalize original file",
      exact: true,
    })
    .click();
  await saved(page);
  expect(posts()).toHaveLength(1);
  const finalize = model.fileCalls.find((c) => c.path.endsWith("/finalize"))!;
  expect(Object.keys(finalize.body!).sort()).toEqual([
    "expectedAttemptRevision",
    "operationId",
    "tenantId",
  ]);
});
test("field-free not-recorded recovery clears marker without replay", async ({
  page,
}) => {
  model.fileHook = (call) =>
    call.path === `/api/knowledge-base/${f.bookId}/files`
      ? { abort: true }
      : undefined;
  await editor(page);
  await choose(page);
  await submit(page);
  await assertCleared(page);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "No file reservation was recorded" }),
  ).toBeVisible();
  expect(posts()).toHaveLength(1);
});
test("a held decoded upload acknowledgement cannot restore departed private UI", async ({
  page,
}) => {
  await editor(page);
  await choose(page);
  await bodyBarrier(page, "POST", `/api/knowledge-base/${f.bookId}/files`);
  await submit(page);
  await waitBody(page);
  const calls = model.calls.length;
  await forceClick(page, "Refresh Knowledge Base");
  expect(model.calls.length).toBe(calls);
  expect(posts()).toHaveLength(1);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic departure", { exact: true }),
  ).toBeVisible();
  await releaseBody(page);
  await expect(page.getByRole("region", { name: "Current file" })).toHaveCount(
    0,
  );
  const marker = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    markerKey,
  );
  expect(marker.action).toBe("save_file");
});
for (const status of [401, 403, 409, 413, 422, 503]) {
  test(`upload ${status} locks until original operation recovery`, async ({
    page,
  }) => {
    model.fileHook = (call) =>
      call.path === `/api/knowledge-base/${f.bookId}/files`
        ? { status, data: { error: "Synthetic upload rejected" } }
        : undefined;
    await editor(page);
    await choose(page);
    await submit(page);
    await assertCleared(page);
    await expect(
      page.getByRole("button", { name: "Retry last action", exact: true }),
    ).toHaveCount(0);
    expect(posts()).toHaveLength(1);
  });
}
test("manager can read file attachments but never sees upload controls or management quota", async ({
  page,
}) => {
  await manager(page, model);
  await openFile(page);
  await expect.poll(() => model.writes("view").length).toBe(3);
  await expect(
    page.getByRole("button", { name: "Download current file", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Edit resource", exact: true }),
  ).toHaveCount(0);
  expect(
    model.fileCalls.filter((c) => c.path.endsWith("/budget")),
  ).toHaveLength(0);
});
test("validated download emits no extra view and revokes temporary object URL", async ({
  page,
}) => {
  await openFile(page);
  await blobBarrier(page);
  await page
    .getByRole("button", { name: "Download current file", exact: true })
    .click();
  await waitBody(page);
  const download = page.waitForEvent("download");
  await releaseBody(page);
  await download;
  await expect(
    page.getByRole("status").filter({ hasText: "File download started" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { kbCreated: number }).kbCreated,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { kbRevoked: number }).kbRevoked,
      ),
    )
    .toBe(1);
  expect(model.writes("view")).toHaveLength(0);
  const call = model.fileCalls.find((c) => c.path.endsWith("/download"))!;
  expect(call.url.searchParams.get("versionId")).toBe(fileVersion);
});
for (const departure of [
  "Switch synthetic actor",
  "Switch synthetic company",
  "Switch synthetic role",
  "Toggle synthetic departure",
  "Refresh Knowledge Base",
]) {
  test(`decoded download body cannot revive prior context after ${departure}`, async ({
    page,
  }) => {
    await openFile(page);
    await blobBarrier(page);
    await page
      .getByRole("button", { name: "Download current file", exact: true })
      .click();
    await waitBody(page);
    await page.getByRole("button", { name: departure, exact: true }).click();
    if (departure === "Toggle synthetic departure")
      await expect(
        page.getByText("Synthetic departure", { exact: true }),
      ).toBeVisible();
    else if (departure !== "Refresh Knowledge Base")
      await expect(
        page.getByRole("region", { name: "Current file" }),
      ).toHaveCount(0);
    else
      await expect(
        page.getByRole("button", {
          name: "Download current file",
          exact: true,
        }),
      ).toBeEnabled();
    await releaseBody(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { kbCreated: number }).kbCreated,
      ),
    ).toBe(0);
    await expect(
      page.getByRole("status").filter({ hasText: "File download started" }),
    ).toHaveCount(0);
  });
}
for (const header of [
  KNOWLEDGE_FILE_HEADERS.actor,
  KNOWLEDGE_FILE_HEADERS.tenant,
  KNOWLEDGE_FILE_HEADERS.base,
  KNOWLEDGE_FILE_HEADERS.node,
  KNOWLEDGE_FILE_HEADERS.version,
  "Content-Type",
  "Content-Length",
  "Cache-Control",
  "Content-Disposition",
  "X-Content-Type-Options",
]) {
  test(`download fails closed on mismatched ${header}`, async ({ page }) => {
    model.fileHook = (call) => {
      if (call.path.endsWith("/download"))
        return {
          bytes: model.bytes,
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": String(model.bytes.length),
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'attachment; filename="field-safety.txt"',
            "X-Content-Type-Options": "nosniff",
            [KNOWLEDGE_FILE_HEADERS.actor]: f.actor,
            [KNOWLEDGE_FILE_HEADERS.tenant]: f.company.id,
            [KNOWLEDGE_FILE_HEADERS.base]: f.bookId,
            [KNOWLEDGE_FILE_HEADERS.node]: fileId,
            [KNOWLEDGE_FILE_HEADERS.version]: fileVersion,
            [header]: header === "Content-Length" ? "1" : "invalid",
          },
        };
    };
    await openFile(page);
    await page
      .getByRole("button", { name: "Download current file", exact: true })
      .click();
    await assertCleared(page);
  });
}
for (const status of [401, 403, 409, 503]) {
  test(`current download ${status} clears private content`, async ({
    page,
  }) => {
    model.fileHook = (call) =>
      call.path.endsWith("/download")
        ? { status, data: { error: "Synthetic current access denied" } }
        : undefined;
    await openFile(page);
    await page
      .getByRole("button", { name: "Download current file", exact: true })
      .click();
    await assertCleared(page);
  });
}
test("malformed safe recovery cannot grant finalize capability for unknown upload", async ({
  page,
}) => {
  model.fileHook = (call) => {
    if (call.path === `/api/knowledge-base/${f.bookId}/files`)
      return { abort: true };
    if (call.path.endsWith("/reconcile"))
      return {
        data: {
          ...model.pending(String(call.body!.operationId)),
          capabilities: {
            canClose: true,
            canFinalize: true,
            canCleanup: false,
          },
        },
      };
  };
  await editor(page);
  await choose(page);
  await submit(page);
  await assertCleared(page);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(page.locator(".kb-error[role=alert]")).toContainText(
    "original file operation could not be verified",
  );
  await expect(
    page.getByRole("button", {
      name: "Verify and finalize original file",
      exact: true,
    }),
  ).toHaveCount(0);
});
test("remount recovers original UUID without retaining selected bytes or private fields", async ({
  page,
}) => {
  model.fileHook = (call) => {
    if (call.path === `/api/knowledge-base/${f.bookId}/files`) {
      model.attempt = model.pending(String(call.body!.operationId));
      return { abort: true };
    }
  };
  await editor(page);
  await choose(page, "private-name.txt");
  await submit(page);
  await assertCleared(page);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic departure", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Knowledge Base recovery" }),
  ).toContainText("never resends file bytes");
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Permanently close file operation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry last action", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("private-name.txt", { exact: true })).toHaveCount(
    0,
  );
  expect(posts()).toHaveLength(1);
});
for (const identity of ["tenantId", "actorId", "role"]) {
  test(`upload receipt rejects changed ${identity}`, async ({ page }) => {
    model.fileHook = (call) => {
      if (call.path === `/api/knowledge-base/${f.bookId}/files`) {
        const receipt = model.save(
          call.body as import("../../lib/knowledge-base-file-types").KnowledgeFileMetadata,
        );
        return {
          data: {
            saved: {
              ...receipt,
              [identity]: identity === "role" ? "employee" : f.otherActor,
            },
          },
        };
      }
    };
    await editor(page);
    await choose(page);
    await submit(page);
    await assertCleared(page);
    expect(posts()).toHaveLength(1);
  });
}
for (const status of [401, 403]) {
  test(`current reconcile ${status} keeps original marker and clears private recovery controls`, async ({
    page,
  }) => {
    model.fileHook = (call) => {
      if (call.path === `/api/knowledge-base/${f.bookId}/files`)
        return { abort: true };
      if (call.path.endsWith("/reconcile"))
        return {
          status,
          data: { error: "Original actor no longer authorized" },
        };
    };
    await editor(page);
    await choose(page);
    await submit(page);
    await assertCleared(page);
    const marker = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      markerKey,
    );
    await page
      .getByRole("button", { name: "Refresh to recover", exact: true })
      .click();
    await assertCleared(page);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), markerKey),
    ).toBe(marker);
    await expect(
      page.getByRole("button", {
        name: "Permanently close file operation",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(posts()).toHaveLength(1);
  });
}
test("held permanent-close acknowledgement blocks actual refresh closure until departure", async ({
  page,
}) => {
  model.fileHook = (call) => {
    if (call.path === `/api/knowledge-base/${f.bookId}/files`) {
      model.attempt = model.pending(String(call.body!.operationId));
      return { abort: true };
    }
  };
  await editor(page);
  await choose(page);
  await submit(page);
  await assertCleared(page);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await bodyBarrier(page, "POST", "/api/knowledge-base/files/close");
  await page
    .getByRole("button", {
      name: "Permanently close file operation",
      exact: true,
    })
    .click();
  await waitBody(page);
  const before = model.calls.length + model.fileCalls.length;
  await forceClick(page, "Refresh Knowledge Base");
  expect(model.calls.length + model.fileCalls.length).toBe(before);
  expect(posts()).toHaveLength(1);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic departure", { exact: true }),
  ).toBeVisible();
  await releaseBody(page);
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).action,
      markerKey,
    ),
  ).toBe("save_file");
  await expect(
    page.getByRole("status").filter({ hasText: "File operation closed." }),
  ).toHaveCount(0);
});
test("quota denial clears editor/private files without inventing zero allocations", async ({
  page,
}) => {
  model.fileHook = (call) =>
    call.path.endsWith("/budget")
      ? { status: 403, data: { error: "Current management denied" } }
      : undefined;
  await openSection(page);
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await assertCleared(page);
  await expect(
    page.getByRole("region", { name: "Reserved and retained budget" }),
  ).toHaveCount(0);
  expect(posts()).toHaveLength(0);
});
test("assigned reader attachment download and manual refresh add no extra rendered-open events", async ({
  page,
}) => {
  await manager(page, model);
  await openFile(page);
  await expect(
    page.getByRole("button", { name: "Download current file", exact: true }),
  ).toBeEnabled();
  expect(model.writes("view")).toHaveLength(3);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download current file", exact: true })
    .click();
  await download;
  await page
    .getByRole("button", { name: "Refresh Knowledge Base", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download current file", exact: true }),
  ).toBeEnabled();
  expect(model.writes("view")).toHaveLength(3);
});
test("archived file download rejects actual forced handler without issuing a request", async ({
  page,
}) => {
  model.nodes.find((n) => n.id === fileId)!.status = "archived";
  await openFile(page);
  await expect(
    page.getByRole("button", { name: "Download current file", exact: true }),
  ).toBeDisabled();
  await forceClick(page, "Download current file");
  expect(
    model.fileCalls.filter((c) => c.path.endsWith("/download")),
  ).toHaveLength(0);
});
test("depth16 folder add-file actual handler does not open editor or reserve a request", async ({
  page,
}) => {
  model.nodes.find((n) => n.id === f.sectionId)!.depth = 16;
  await openSection(page);
  await expect(
    page.getByRole("button", { name: "Add file", exact: true }),
  ).toBeDisabled();
  await forceClick(page, "Add file");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(model.fileCalls).toHaveLength(0);
});
for (const leaf of ["title search", "resource insights"] as const) {
  test(`held decoded file body cannot download after actual ${leaf} handler enters alternate pane`, async ({
    page,
  }) => {
    await openFile(page);
    await blobBarrier(page);
    await page.evaluate(() => {
      const original = HTMLAnchorElement.prototype.click;
      Object.assign(window, { kbAnchorClicks: 0 });
      HTMLAnchorElement.prototype.click = function () {
        const state = window as unknown as { kbAnchorClicks: number };
        state.kbAnchorClicks++;
        return original.call(this);
      };
    });
    let downloads = 0;
    page.on("download", () => downloads++);
    await page
      .getByRole("button", { name: "Download current file", exact: true })
      .click();
    await waitBody(page);
    if (leaf === "resource insights") {
      await forceClick(page, "Resource insights");
      await expect(
        page.getByRole("region", { name: "Knowledge Base insights" }),
      ).toBeVisible();
    } else {
      // Invoke the actual attached React submit closure, not a duplicate handler
      // or DOM-only disabled mutation. This executes the production readSearch.
      await page
        .getByRole("button", { name: "Find resources", exact: true })
        .evaluate((element) => {
          const form = element.closest("form");
          if (!form) throw new Error("Search form missing");
          const key = Object.keys(form).find((value) =>
            value.startsWith("__reactProps$"),
          );
          const props = key
            ? (
                form as unknown as Record<
                  string,
                  { onSubmit?: (event: { preventDefault: () => void }) => void }
                >
              )[key]
            : null;
          if (typeof props?.onSubmit !== "function")
            throw new Error("Actual React search submit handler missing");
          props.onSubmit({ preventDefault() {} });
        });
      await expect(
        page.getByRole("region", { name: "Knowledge Base title results" }),
      ).toBeVisible();
    }
    if (leaf === "title search")
      await expect(
        page.getByRole("region", { name: "Current file" }),
      ).toHaveCount(0);
    await releaseBody(page);
    // Await the held blob's continuation and its queued effects, so an old
    // handler that creates/clicks an attachment deterministically fails here.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { kbCreated: number }).kbCreated,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { kbAnchorClicks: number }).kbAnchorClicks,
      ),
    ).toBe(0);
    expect(downloads).toBe(0);
    await expect(
      page.getByRole("status").filter({ hasText: "File download started" }),
    ).toHaveCount(0);
    if (leaf === "resource insights") {
      await page
        .getByRole("button", {
          name: "Close Knowledge Base insights",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Download current file",
          exact: true,
        }),
      ).toBeEnabled();
    }
  });
}
