import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** @type {import('next').NextConfig} */
const config={reactStrictMode:true,poweredByHeader:false,output:'standalone',outputFileTracingRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),
 transpilePackages:['@createcanyon/web','@createcanyon/security','@createcanyon/contracts','@createcanyon/web-auth','@createcanyon/config'],
 serverExternalPackages:['ioredis'],experimental:{serverActions:{bodySizeLimit:'512kb'}}};
export default config;
