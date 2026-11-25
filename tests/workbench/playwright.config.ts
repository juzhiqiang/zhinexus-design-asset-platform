import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,timeout:90000,expect:{timeout:8000},use:{headless:true,viewport:{width:1440,height:960},trace:'retain-on-failure',screenshot:'only-on-failure'},outputDir:'../../test-results/workbench'});

