import {parseApiEnvironment} from "@createcanyon/config";
import {z} from "zod";
export const apiEnv=parseApiEnvironment(process.env);
export const workerEnv=z.object({
 WORKER_KIND:z.enum(["all","files","search","payments","tax","transfers","notifications"]).default("all"),
 WORKER_POLL_INTERVAL_MS:z.coerce.number().int().min(250).max(60000).default(1000),
 CLAMAV_HOST:z.string().default("127.0.0.1"),CLAMAV_PORT:z.coerce.number().int().default(3310),
 CLAMAV_MAX_STREAM_BYTES:z.coerce.number().int().positive().default(2147483648),
 ALLOW_UNSCANNED_DEV_FIXTURES:z.enum(["true","false"]).default("false"),
 PROCESSOR_MODE:z.enum(["native","container"]).default("native"),PROCESSOR_IMAGE:z.string().default("createcanyon-processor:local"),
 PROCESSOR_TEMP_DIR:z.string().default("/tmp"),CODE_SCANNERS:z.string().default(""),
 ENABLE_AUDIO_PROCESSOR:z.enum(["true","false"]).default("false"),ENABLE_DOCUMENT_PROCESSOR:z.enum(["true","false"]).default("false"),
 EMAIL_PROVIDER:z.enum(["none","smtp","ses"]).default("none"),MAIL_FROM:z.string().email().default("no-reply@createcanyon.localhost"),
 SMTP_HOST:z.string().default("127.0.0.1"),SMTP_PORT:z.coerce.number().int().default(1025),SES_REGION:z.string().default("ap-southeast-2"),
}).parse(process.env);
if(apiEnv.NODE_ENV==="production"&&(workerEnv.ALLOW_UNSCANNED_DEV_FIXTURES!=="false"||workerEnv.PROCESSOR_MODE!=="container"))throw new Error("Production file processing requires antivirus and an isolated, network-disabled processor container");
export type WorkerEnv=typeof workerEnv;
