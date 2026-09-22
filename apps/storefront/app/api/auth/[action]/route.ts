import {authRoute} from '@createcanyon/web/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handler(request:Request,context:{params:Promise<{action:string}>}){return authRoute('storefront',(await context.params).action,request);}
export {handler as GET,handler as POST};
