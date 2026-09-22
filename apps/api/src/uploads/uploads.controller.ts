import { Body, Controller, Param, Post } from "@nestjs/common";
import { createUploadSessionSchema, finalizeUploadSchema } from "@createcanyon/contracts";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import type { Principal } from "../auth/auth.types.js";
import { parseWith } from "../common/zod.js";
import { UploadsService } from "./uploads.service.js";

@Controller("uploads")
export class UploadsController {
  public constructor(private readonly uploads: UploadsService) {}

  @Post("sessions")
  public create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.uploads.create(principal, parseWith(createUploadSessionSchema, body));
  }

  @Post("sessions/:id/finalize")
  public finalize(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @Body() body: unknown) {
    const input = parseWith(finalizeUploadSchema, body);
    return this.uploads.finalize(principal, id, input.files.map((file) => file.clientFileId));
  }
}
