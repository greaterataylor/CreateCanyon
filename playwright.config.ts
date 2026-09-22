import {defineConfig,devices} from '@playwright/test';
// Start the local services and `pnpm dev` separately. No automatic authentication bypass.
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,retries:process.env.CI?1:0,
 reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
 use:{baseURL:process.env.E2E_STOREFRONT_URL??'http://localhost:3000',trace:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
