import { expect, type Page, type Route } from "@playwright/test";
import { Model } from "./helpers";
import * as f from "./fixture-data";
import {
  KNOWLEDGE_FILE_HEADERS,
  type KnowledgeFileMetadata,
  type KnowledgeFileSaved,
  type KnowledgeFileAttemptData,
  type KnowledgeFileBudgetData,
} from "../../lib/knowledge-base-file-types";
export const fileId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
export const fileVersion = "99999999-9999-4999-8999-999999999991";
export type FileCall = {
  path: string;
  method: string;
  body: Record<string, unknown> | KnowledgeFileMetadata | null;
  raw: Buffer | null;
  url: URL;
};
export type FileReply = {
  status?: number;
  data?: unknown;
  abort?: boolean;
  headers?: Record<string, string>;
  bytes?: Buffer;
};
export class FileModel extends Model {
  fileCalls: FileCall[] = [];
  fileHook:
    ((call: FileCall) => Promise<FileReply | void> | FileReply | void) | null =
    null;
  bytes = Buffer.from("Original synthetic UTF-8 operating guide\n");
  attempt: KnowledgeFileAttemptData | null = null;
  uploads: KnowledgeFileMetadata[] = [];
  constructor(page: Page) {
    super(page);
    this.nodes.push({
      ...f.nodes.find((v) => v.id === f.textId)!,
      id: fileId,
      kind: "file",
      name: "Field safety attachment",
      description: "Original synthetic file resource",
      currentFile: {
        versionId: fileVersion,
        filename: "field-safety.txt",
        mediaType: "text/plain",
        bytes: this.bytes.length,
        sha256: "a".repeat(64),
        uploadedAt: f.timestamp,
        uploaderName: "Morgan Example",
      },
    });
  }
  fileIdentity() {
    return { tenantId: this.tenant, actorId: this.actor, role: this.role };
  }
  budget(): KnowledgeFileBudgetData {
    return {
      ...this.fileIdentity(),
      allocatedBytes: 7340032,
      allocatedAttempts: 7,
      byteLimit: 104857600,
      globalAttemptLimit: 4096,
      companyAttemptLimit: 2048,
      states: {
        upload_attempted: 1,
        uploaded_unverified: 1,
        provider_succeeded: 1,
        finalized: 2,
        closed: 1,
        cleanup_acknowledged: 1,
      },
      serverTime: f.timestamp,
    };
  }
  pending(
    operationId: string,
    status: KnowledgeFileAttemptData["status"] = "uploaded_unverified",
  ): KnowledgeFileAttemptData {
    return {
      ...this.fileIdentity(),
      operationId,
      action: "save_file",
      status,
      attemptRevision: status === "not_recorded" ? null : 1,
      deadline: status === "not_recorded" ? null : f.timestamp,
      capabilities: {
        canFinalize: status === "provider_succeeded",
        canClose: [
          "upload_attempted",
          "uploaded_unverified",
          "provider_succeeded",
        ].includes(status),
        canCleanup: false,
      },
      saved: null,
      serverTime: f.timestamp,
    };
  }
  save(metadata: KnowledgeFileMetadata): KnowledgeFileSaved {
    const base = this.bases.find((v) => v.id === metadata.baseId)!;
    base.revision++;
    let node =
      metadata.mode === "replace"
        ? this.nodes.find((v) => v.id === metadata.nodeId)!
        : null;
    if (!node) {
      node = {
        ...f.nodes.find((v) => v.id === f.textId)!,
        id: this.id(),
        parentId: metadata.mode === "create" ? metadata.parentId : null,
        kind: "file",
        name: metadata.name,
        description: metadata.description,
        revision: 1,
      };
      this.nodes.push(node);
    } else node.revision++;
    node.name = metadata.name;
    node.description = metadata.description;
    node.currentFile = {
      versionId: this.id(),
      filename: metadata.filename,
      mediaType: "text/plain",
      bytes: this.bytes.length,
      sha256: "b".repeat(64),
      uploadedAt: f.timestamp,
      uploaderName: "Morgan Example",
    };
    return {
      ...this.fileIdentity(),
      operationId: metadata.operationId,
      action: "save_file",
      baseId: base.id,
      nodeId: node.id,
      revision: base.revision,
      nodeRevision: node.revision,
      versionId: node.currentFile.versionId,
    };
  }
  async route(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    if (!(
      /\/files(?:\/|$)/.test(url.pathname) || url.pathname.endsWith("/download")
    ))
      return super.route(route);
    const raw = request.postDataBuffer();
    let body: FileCall["body"] = null;
    if (request.method() === "POST") {
      if (
        request.headers()["content-type"]?.startsWith("multipart/form-data")
      ) {
        const match = raw
          ?.toString("utf8")
          .match(/name="metadata"\r\n\r\n([\s\S]*?)\r\n--/);
        if (!match) throw new Error("Strict multipart metadata missing");
        body = JSON.parse(match[1]) as KnowledgeFileMetadata;
        this.uploads.push(body as KnowledgeFileMetadata);
      } else body = request.postDataJSON() as Record<string, unknown>;
    }
    const call = {
      url,
      path: url.pathname,
      method: request.method(),
      body,
      raw,
    };
    this.fileCalls.push(call);
    let reply = await this.fileHook?.(call);
    if (!reply) {
      if (url.pathname.endsWith("/budget")) reply = { data: this.budget() };
      else if (url.pathname.endsWith("/download")) {
        const node = this.nodes.find(
          (v) => v.id === url.pathname.split("/")[5],
        )!;
        const current = node.currentFile!;
        reply = {
          bytes: this.bytes,
          headers: {
            "Content-Type": current.mediaType,
            "Content-Length": String(this.bytes.length),
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'attachment; filename="field-safety.txt"',
            "X-Content-Type-Options": "nosniff",
            [KNOWLEDGE_FILE_HEADERS.actor]: this.actor,
            [KNOWLEDGE_FILE_HEADERS.tenant]: this.tenant,
            [KNOWLEDGE_FILE_HEADERS.base]: f.bookId,
            [KNOWLEDGE_FILE_HEADERS.node]: node.id,
            [KNOWLEDGE_FILE_HEADERS.version]: current.versionId,
          },
        };
      } else if (url.pathname.endsWith("/reconcile"))
        reply = {
          data:
            this.attempt ||
            this.pending(String(body!.operationId), "not_recorded"),
        };
      else if (url.pathname.endsWith("/close")) {
        this.attempt = {
          ...this.pending(String(body!.operationId), "closed"),
          capabilities: {
            canClose: false,
            canFinalize: false,
            canCleanup: false,
          },
          attemptRevision: 2,
        };
        reply = { data: this.attempt };
      } else if (url.pathname.endsWith("/finalize")) {
        const saved = this.save(this.uploads.at(-1)!);
        this.attempt = {
          ...this.pending(saved.operationId, "finalized"),
          saved,
        };
        reply = { data: { saved } };
      } else {
        const saved = this.save(body as KnowledgeFileMetadata);
        this.attempt = {
          ...this.pending(saved.operationId, "finalized"),
          saved,
        };
        reply = { data: { saved } };
      }
    }
    if (reply.abort) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: reply.status || 200,
      headers: reply.headers,
      contentType: reply.bytes ? undefined : "application/json",
      body:
        reply.bytes ||
        JSON.stringify(reply.data ?? { error: "Synthetic file failure" }),
    });
  }
}
export async function openFile(page: Page) {
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Open folder Company Information",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Open resource Field safety attachment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Current file" }),
  ).toBeVisible();
}
export async function blobBarrier(page: Page) {
  await page.evaluate(() => {
    const original = window.fetch;
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    Object.assign(window, {
      kbRelease: release,
      kbBodyHeld: false,
      kbCreated: 0,
      kbRevoked: 0,
    });
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const state = window as unknown as { kbCreated: number };
      state.kbCreated++;
      return create(blob);
    };
    URL.revokeObjectURL = (url) => {
      const state = window as unknown as { kbRevoked: number };
      state.kbRevoked++;
      revoke(url);
    };
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input).split("?")[0].endsWith("/download")) {
        const blob = response.blob.bind(response);
        response.blob = async () => {
          const value = await blob();
          Object.assign(window, { kbBodyHeld: true });
          await promise;
          return value;
        };
      }
      return response;
    };
  });
}
