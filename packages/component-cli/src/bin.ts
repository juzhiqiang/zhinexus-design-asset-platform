#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runCli } from './cli.js';
import { createInterface } from 'node:readline/promises';

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const result = await runCli(process.argv.slice(2), pkg.version, {
  onProgress: message => process.stderr.write(message + '\n'),
  ...(process.stdin.isTTY && process.stderr.isTTY ? {
    prompt: async (label: string, defaultValue?: string) => {
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      const labels: Record<string, string> = { package: '组件包目录', component: '组件 ID', export: '组件导出名称' };
      try { return await reader.question((labels[label] ?? label) + (defaultValue ? ` [${defaultValue}]` : '') + ': '); }
      finally { reader.close(); }
    },
    select: async (label: string, choices: { value: string; label: string }[]) => {
    const reader = createInterface({ input: process.stdin, output: process.stderr });
    try {
      process.stderr.write(label + '\n' + choices.map((choice, index) => `${index + 1}. ${choice.label} (${choice.value})`).join('\n') + '\n');
      const answer = (await reader.question('请选择编号或 ID: ')).trim();
      return choices[Number(answer) - 1]?.value ?? answer;
    } finally { reader.close(); }
  } } : {}),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
