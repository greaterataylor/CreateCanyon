import {backendRoute} from '@createcanyon/web/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handler(request:Request,context:{params:Promise<{path:string[]}>}){return backendRoute('storefront',(await context.params).path,request);}
export {handler as GET,handler as POST,handler as PATCH,handler as DELETE};
