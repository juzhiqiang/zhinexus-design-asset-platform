#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runCli } from './cli.js';

const pkg: { version: string } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const result = runCli(process.argv.slice(2), pkg.version);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
