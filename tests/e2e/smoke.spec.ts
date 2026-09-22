import {test,expect} from '@playwright/test';
test('The storefront has a real homepage, navigation and catalog',async({page})=>{
 const response=await page.goto('/');expect(response?.status()).toBe(200);await expect(page.getByRole('main')).toBeVisible();await expect(page.getByRole('heading',{level:1})).toBeVisible();
 const catalog=await page.goto('/catalog');expect(catalog?.status()).toBe(200);await expect(page.getByRole('main')).toBeVisible();
});
test('Hostname branding supports all five local channels',async({request})=>{
 for(const [host,name] of [['createcanyon','CreateCanyon'],['graphicgrounds','GraphicGrounds'],['melodymerchant','MelodyMerchant'],['filefoyer','FileFoyer'],['programplaza','ProgramPlaza']]){
  const response=await request.get(`http://${host}.localhost:3000/`);expect(response.status()).toBe(200);expect(await response.text()).toContain(name);
 }
});
test('Authenticated library is not exposed through an anonymous browser proxy',async({request})=>{
 const response=await request.get((process.env.E2E_DASHBOARD_URL??'http://localhost:3001')+'/api/backend/library');expect(response.status()).toBe(401);
});
test('Cross-origin mutations are rejected before reaching the API',async({request})=>{
 const response=await request.post('/api/backend/cart',{headers:{origin:'https://untrusted.invalid','content-type':'application/json'},data:{}});expect(response.status()).toBe(403);
});
test('API denies anonymous purchase and administration reads',async({request})=>{
 for(const resource of ['library','admin/overview']){const response=await request.get((process.env.E2E_API_URL??'http://127.0.0.1:4000')+'/v1/'+resource);expect(response.status()).toBe(401);}
});
