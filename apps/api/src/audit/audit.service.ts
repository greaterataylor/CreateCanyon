import { Inject, Injectable } from "@nestjs/common";
import { auditEvents, type DatabaseConnection } from "@createcanyon/database";
import { DB_CONNECTION } from "../common/tokens.js";

export interface AuditInput {
  readonly actorUserId?: string;
  readonly actorType: "USER" | "ADMIN" | "SYSTEM" | "WEBHOOK";
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  public constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}
  public async record(input: AuditInput): Promise<void> {
    await this.connection.db.insert(auditEvents).values({
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.before ? { before: input.before } : {}),
      ...(input.after ? { after: input.after } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      metadata: input.metadata ?? {},
    });
  }
}
