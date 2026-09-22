import { Global, Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { ApiAuthGuard } from "./auth.guard.js";
import { UsersService } from "./users.service.js";

@Global()
@Module({
  providers: [Reflector, UsersService, { provide: APP_GUARD, useClass: ApiAuthGuard }],
  exports: [UsersService],
})
export class AuthModule {}
