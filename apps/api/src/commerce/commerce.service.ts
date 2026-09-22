import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@createcanyon/config";
import type { DatabaseConnection } from "@createcanyon/database";
import { PaymentEngine, type CheckoutRequest } from "@createcanyon/payments";
import type { Principal } from "../auth/auth.types.js";
import { UsersService } from "../auth/users.service.js";
import { API_ENV, DB_CONNECTION } from "../common/tokens.js";
@Injectable()
export class CommerceService {
  readonly engine:PaymentEngine;
  constructor(@Inject(DB_CONNECTION) connection:DatabaseConnection,@Inject(API_ENV) env:ApiEnvironment,private readonly users:UsersService){this.engine=new PaymentEngine(connection,env);}
  async getCart(p:Principal,currency="USD"){return this.engine.getCart((await this.users.resolveUser(p)).id,currency);}
  async addLine(p:Principal,input:{listingId:string;licenseVariantId:string;quantity:number}){return this.engine.addLine((await this.users.resolveUser(p)).id,input);}
  async removeLine(p:Principal,id:string){return this.engine.removeLine((await this.users.resolveUser(p)).id,id);}
  async checkout(p:Principal,input:CheckoutRequest,key:string){return this.engine.checkout((await this.users.resolveUser(p)).id,input,key);}
  async resume(p:Principal,orderId:string){return this.engine.ensurePayment(orderId,(await this.users.resolveUser(p)).id);}
  handleStripeWebhook(body:Buffer,signature:string|undefined){return this.engine.ingestWebhook(body,signature);}
}
