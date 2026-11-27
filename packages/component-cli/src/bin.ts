#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runCli } from './cli.js';
import { createInterface } from 'node:readline/promises';
import { readSecret } from './terminal.js';

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const result = await runCli(process.argv.slice(2), pkg.version, {
  onProgress: message => process.stderr.write(message + '\n'),
  ...(process.stdin.isTTY && process.stderr.isTTY ? {
    promptSecret: (label: string) => readSecret(({ password: '密码', token: 'Token', newPassword: '首次登录，请设置新密码（至少 12 个字符）', confirmPassword: '再次输入新密码' } as Record<string, string>)[label] ?? label),
    prompt: async (label: string, defaultValue?: string) => {
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      const labels: Record<string, string> = { package: '组件包目录', component: '组件 ID', export: '组件导出名称', username: '账号' };
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
