// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from 'hono';
import { type AppEnv } from './auth';
import { exportData, purgeData } from './life';
import { listChanges } from './routes/changes';
import { getEvent, patchEvent } from './routes/events';

/**
 * 日历「改」功能模块入口。
 *
 * 这个文件只负责挂载：路由和生命周期端点一次定好后，业务实现都在各自文件里演进
 * （index.ts 反复改动是两人协作里最典型的冲突源）。
 */

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ ok: true, service: 'module-calendar' }));

/**
 * 顺序要紧：/api/events/changes 必须先于 /api/events/:id 注册，
 * 否则 changes 会被当成一个 id。
 */
app.get('/api/events/changes', listChanges);
app.get('/api/events/:id', getEvent);
app.patch('/api/events/:id', patchEvent);

app.get('/life/export', exportData);
app.post('/life/purge', purgeData);

/** 模块页：样式只引用 --unself-* 令牌，不持有颜色值；页面内请求全用相对路径。 */
app.get('/', (c) => {
  return c.html(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>团队日历</title>
  <style>
    * { box-sizing: border-box; }
    body { margin:0; font:var(--unself-font-size-base)/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;
           color:var(--unself-color-text); background:var(--unself-color-bg); }
    main { display:flex; min-height:100vh; align-items:center; justify-content:center; padding:var(--unself-space-4); }
    .card { display:flex; flex-direction:column; gap:var(--unself-space-3); max-width:32rem;
            padding:var(--unself-space-6); border:1px solid var(--unself-color-border); border-radius:var(--unself-radius-lg); }
    .title { font-size:var(--unself-font-size-lg); font-weight:600; }
    .desc { font-size:var(--unself-font-size-sm); color:var(--unself-color-text-secondary); }
    .status { font-size:var(--unself-font-size-sm); font-variant-numeric:tabular-nums; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <span class="title">团队日历</span>
      <span class="desc">编辑已有日程：标题、时间、时区、地点、全天、状态。两人同时改只有一个成功。</span>
      <span class="status" id="status">检查服务中…</span>
    </div>
  </main>
  <script type="module">
    const el = document.getElementById('status');
    try {
      const res = await fetch('api/health');
      const body = await res.json();
      el.textContent = res.ok && body.ok ? '服务正常' : '服务异常';
    } catch {
      el.textContent = '服务不可达';
    }
  </script>
</body>
</html>`);
});

export default app;
