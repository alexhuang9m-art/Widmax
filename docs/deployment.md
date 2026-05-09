# 公网静态部署（分享）

本应用为 Vite 单页前端，构建产物在 `dist/`。视频与 IndexedDB 始终在访问者本机，仅页面从 CDN 加载。

## 1. 推送代码到远程（首次）

本地已初始化 Git 并完成首条提交。关联远程并推送：

```bash
cd /path/to/Widmax
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 2. Vercel（推荐）

1. 打开 [Vercel](https://vercel.com)，用 GitHub/GitLab/Bitbucket 登录并 **Import** 上述仓库。
2. 构建设置一般会由根目录 [vercel.json](../vercel.json) 覆盖，保持默认即可：
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
3. 部署完成后使用提供的 `https://xxx.vercel.app` 分享链接。

根目录已配置 SPA `rewrites`，避免将来增加客户端路由时深层路径 404。

## 3. Netlify / Cloudflare Pages（备选）

- **Netlify**：Build `npm run build`，Publish directory `dist`。已提供 [public/_redirects](../public/_redirects)，构建时会复制到 `dist/`。
- **Cloudflare Pages**：同样命令与输出目录；控制台中可开启 SPA fallback（与 `_redirects` 二选一即可）。

## 4. 冒烟检查

- 无痕窗口打开线上 URL，确认 UI 与控制台无报错。
- **Import Folder**、多路播放、总控、自动对齐、刷新后 IndexedDB 列表恢复（同域名同浏览器）。

## 5. 子路径部署（可选）

若站点地址为 `https://example.com/widmax/` 而非根路径，在 [vite.config.ts](../vite.config.ts) 中设置：

```ts
export default defineConfig({
  base: '/widmax/',
  plugins: [react()],
})
```

重新构建并部署。根域名部署请勿修改 `base`（保持默认 `'/'`）。
