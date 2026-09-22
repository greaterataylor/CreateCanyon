import type { ApiEnvironment } from "@createcanyon/config";
import type { CreateUploadSessionInput } from "@createcanyon/contracts";
import {
  catalogItems,
  fileObjects,
  itemVersions,
  outboxEvents,
  uploadSessions,
  type DatabaseConnection,
} from "@createcanyon/database";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { Principal } from "../auth/auth.types.js";
import { API_ENV, DB_CONNECTION } from "../common/tokens.js";
import { SellersService } from "../sellers/sellers.service.js";
import { StorageService } from "../storage/storage.service.js";

const archiveTypes = new Set(["application/zip", "application/x-zip-compressed", "application/x-tar", "application/gzip", "application/x-gzip"]);
const rightsTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function permittedDeclaredType(assetType: string, role: string, contentType: string): boolean {
  const normalized = contentType.toLowerCase().split(";", 1)[0] ?? "";
  if (["RELEASE", "LICENSE"].includes(role)) return rightsTypes.has(normalized);
  if (archiveTypes.has(normalized)) return true;
  if (["PHOTO", "ILLUSTRATION", "VECTOR", "DESIGN_TEMPLATE", "THREE_D"].includes(assetType)) {
    return normalized.startsWith("image/") || ["application/pdf", "application/postscript"].includes(normalized);
  }
  if (assetType === "FONT") return normalized.startsWith("font/") || ["application/vnd.ms-fontobject", "application/octet-stream"].includes(normalized);
  if (["MUSIC", "SOUND_EFFECT", "AUDIO_LOOP"].includes(assetType)) return normalized.startsWith("audio/");
  if (["DOCUMENT_TEMPLATE", "PRESENTATION_TEMPLATE", "SPREADSHEET_TEMPLATE", "PRINTABLE"].includes(assetType)) {
    return normalized.startsWith("application/") || normalized.startsWith("text/");
  }
  if (["CODE", "PLUGIN", "THEME", "INTEGRATION", "DEVELOPER_TOOL"].includes(assetType)) return archiveTypes.has(normalized) || normalized === "text/plain";
  return false;
}

function safeFilename(input: string): string {
  const withoutPath = input.replaceAll("\\", "/").split("/").pop() ?? "file";
  const clean = [...withoutPath].map((character) => character.charCodeAt(0) < 32 ? "_" : character).join("").trim();
  if (!clean || clean === "." || clean === "..") throw new BadRequestException({ code: "INVALID_FILENAME", message: "A supplied filename is invalid" });
  return clean.slice(0, 255);
}

@Injectable()
export class UploadsService {
  public constructor(
    @Inject(DB_CONNECTION) private readonly connection: DatabaseConnection,
    @Inject(API_ENV) private readonly environment: ApiEnvironment,
    private readonly sellers: SellersService,
    private readonly storage: StorageService,
  ) {}

  public async create(principal: Principal, input: CreateUploadSessionInput) {
    const { user } = await this.sellers.assertMembership(principal, input.sellerOrganisationId, ["OWNER", "MANAGER", "UPLOADER"]);
    const [version] = await this.connection.db
      .select({ version: itemVersions, item: catalogItems })
      .from(itemVersions)
      .innerJoin(catalogItems, eq(itemVersions.itemId, catalogItems.id))
      .where(and(eq(itemVersions.id, input.itemVersionId), eq(catalogItems.sellerOrganisationId, input.sellerOrganisationId)))
      .limit(1);
    if (!version) throw new NotFoundException({ code: "ITEM_VERSION_NOT_FOUND", message: "Item version was not found" });
    if (!["DRAFT", "CHANGES_REQUESTED"].includes(version.version.status)) {
      throw new BadRequestException({ code: "VERSION_NOT_UPLOADABLE", message: "This item version cannot accept uploads in its current state" });
    }
    const totalBytes = input.files.reduce((sum, file) => sum + file.byteSize, 0);
    if (totalBytes > this.environment.MAX_UPLOAD_BYTES) {
      throw new BadRequestException({ code: "UPLOAD_TOO_LARGE", message: "The upload exceeds the configured maximum total size" });
    }
    for (const file of input.files) {
      if (file.byteSize > this.environment.MAX_UPLOAD_BYTES) throw new BadRequestException({ code: "FILE_TOO_LARGE", message: `${file.filename} exceeds the maximum file size` });
      if (!permittedDeclaredType(version.item.assetType, file.role, file.contentType)) {
        throw new BadRequestException({ code: "DECLARED_FILE_TYPE_NOT_ALLOWED", message: `${file.filename} has a file type not allowed for ${version.item.assetType}` });
      }
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.environment.UPLOAD_URL_TTL_SECONDS * 1000);
    const fileRows = input.files.map((file) => ({
      id: crypto.randomUUID(),
      clientFileId: file.clientFileId,
      itemVersionId: input.itemVersionId,
      uploadSessionId: sessionId,
      role: file.role,
      bucket: this.environment.S3_QUARANTINE_BUCKET,
      objectKey: `quarantine/${input.sellerOrganisationId}/${input.itemVersionId}/${sessionId}/${file.clientFileId}`,
      originalFilename: safeFilename(file.filename),
      declaredMimeType: file.contentType.toLowerCase().split(";", 1)[0] ?? file.contentType,
      byteSize: BigInt(file.byteSize),
      sha256: file.sha256.toLowerCase(),
      state: "PENDING" as const,
    }));

    await this.connection.db.transaction(async (tx) => {
      await tx.insert(uploadSessions).values({
        id: sessionId,
        sellerOrganisationId: input.sellerOrganisationId,
        itemVersionId: input.itemVersionId,
        createdByUserId: user.id,
        status: "UPLOADING",
        expiresAt,
      });
      await tx.insert(fileObjects).values(fileRows);
    });

    const files = await Promise.all(fileRows.map(async (file) => ({
      clientFileId: file.clientFileId,
      filename: file.originalFilename,
      byteSize: Number(file.byteSize),
      ...(await this.storage.createUploadUrl({ key: file.objectKey, contentType: file.declaredMimeType, byteSize: Number(file.byteSize), sha256Hex: file.sha256 })),
    })));
    return { uploadSessionId: sessionId, expiresAt: expiresAt.toISOString(), files };
  }

  public async finalize(principal: Principal, uploadSessionId: string, clientFileIds: readonly string[]) {
    const [session] = await this.connection.db.select().from(uploadSessions).where(eq(uploadSessions.id, uploadSessionId)).limit(1);
    if (!session) throw new NotFoundException({ code: "UPLOAD_SESSION_NOT_FOUND", message: "Upload session was not found" });
    await this.sellers.assertMembership(principal, session.sellerOrganisationId, ["OWNER", "MANAGER", "UPLOADER"]);
    if (session.expiresAt <= new Date()) throw new BadRequestException({ code: "UPLOAD_SESSION_EXPIRED", message: "Upload session has expired" });
    if (session.status === "FINALIZED") return { uploadSessionId, status: "FINALIZED" };
    if (session.status !== "UPLOADING") throw new BadRequestException({ code: "UPLOAD_SESSION_NOT_FINALIZABLE", message: "Upload session cannot be finalized" });
    const files = await this.connection.db.select().from(fileObjects).where(and(eq(fileObjects.uploadSessionId, uploadSessionId), inArray(fileObjects.clientFileId, [...clientFileIds])));
    const allFiles = await this.connection.db.select().from(fileObjects).where(eq(fileObjects.uploadSessionId, uploadSessionId));
    if (files.length !== allFiles.length || new Set(clientFileIds).size !== allFiles.length) {
      throw new BadRequestException({ code: "UPLOAD_MANIFEST_MISMATCH", message: "Finalization must include every file in the upload session exactly once" });
    }
    for (const file of files) {
      const head = await this.storage.headQuarantined(file.objectKey).catch(() => null);
      if (!head) throw new BadRequestException({ code: "UPLOADED_OBJECT_MISSING", message: `${file.originalFilename} was not uploaded` });
      if (head.ContentLength !== undefined && BigInt(head.ContentLength) !== file.byteSize) {
        throw new BadRequestException({ code: "UPLOADED_SIZE_MISMATCH", message: `${file.originalFilename} does not match the declared size` });
      }
      const declaredHash = head.Metadata?.declaredsha256;
      if (declaredHash && declaredHash.toLowerCase() !== file.sha256) {
        throw new BadRequestException({ code: "UPLOADED_HASH_METADATA_MISMATCH", message: `${file.originalFilename} does not match the declared checksum` });
      }
    }
    await this.connection.db.transaction(async (tx) => {
      await tx.update(fileObjects).set({ state: "QUARANTINED", updatedAt: new Date() }).where(eq(fileObjects.uploadSessionId, uploadSessionId));
      await tx.update(uploadSessions).set({ status: "FINALIZED", finalizedAt: new Date() }).where(eq(uploadSessions.id, uploadSessionId));
      await tx.update(itemVersions).set({ status: "SCANNING", submittedAt: new Date(), updatedAt: new Date() }).where(eq(itemVersions.id, session.itemVersionId));
      const [version] = await tx.select().from(itemVersions).where(eq(itemVersions.id, session.itemVersionId)).limit(1);
      if (version) await tx.update(catalogItems).set({ status: "SCANNING", updatedAt: new Date() }).where(eq(catalogItems.id, version.itemId));
      await tx.insert(outboxEvents).values({
        eventType: "ASSET_PROCESS_REQUESTED",
        aggregateType: "item_version",
        aggregateId: session.itemVersionId,
        payload: { uploadSessionId, itemVersionId: session.itemVersionId },
      });
    });
    return { uploadSessionId, status: "FINALIZED", itemVersionStatus: "SCANNING" };
  }
}
