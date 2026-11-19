// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 日历模块发布产物构建：
 *
 * 1. dist/worker.js   CF 装配入口：src/index.ts 全量 bundle（deps 全内联，部署零安装）。
 * 2. dist/manifest.json  manifest.yaml 的副本，构建期用 @unself/contracts 的 schema 校验，
 *    坏清单打不出包。
 *
 * 路径处理用 fileURLToPath：`new URL('..', import.meta.url).pathname` 在 Windows 上会变成
 * `/E:/...`，esbuild 直接报 not an absolute path。
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SPDX_BANNER = '// SPDX-License-Identifier: AGPL-3.0-only';
const HERE = fileURLToPath(new URL('..', import.meta.url));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  absWorkingDir: HERE,
  outfile: 'dist/worker.js',
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  legalComments: 'none',
  banner: { js: SPDX_BANNER },
  logLevel: 'warning',
});

console.log('▣ calendar 产物就绪：dist/worker.js（CF 装配入口）');

const require2 = createRequire(import.meta.url);
// 用 node 直接执行 tsx 的 cli 脚本：Windows 上 execFileSync 直接跑 .mjs/.js 会走
// 可执行文件查找，报 spawn ENOENT（hello 的写法在 POSIX 可用，Windows 不行）。
execFileSync(
  process.execPath,
  [
    require2.resolve('tsx/cli'),
    '--eval',
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { ModuleManifestSchema, manifestFromYamlText } from '@unself/contracts';",
      "const manifest = ModuleManifestSchema.parse(manifestFromYamlText(readFileSync('manifest.yaml', 'utf8')));",
      "writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\\n');",
      "console.log('▣ dist/manifest.json 就绪（manifest.yaml 副本，schema 已校验）');",
    ].join('\n'),
  ],
  { cwd: HERE, stdio: 'inherit' },
);
