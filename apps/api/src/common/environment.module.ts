import { Global, Module } from "@nestjs/common";
import { parseApiEnvironment } from "@createcanyon/config";
import { API_ENV } from "./tokens.js";

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => parseApiEnvironment(process.env) }],
  exports: [API_ENV],
})
export class EnvironmentModule {}
