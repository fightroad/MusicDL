# MusicDL

基于洛雪（LX Music）自定义音源的本地 Web 工具：搜索、试听、下载。

## 要求

Node.js ≥ 22

## 运行

```bash
npm install
npm start
```

打开 http://127.0.0.1:8000

开发：`npm run dev`

## 使用

1. 「音源管理」导入洛雪脚本（URL 或本地 `.js`）
2. 选择音源后搜索
3. 试听 / 下载由音源脚本的 `musicUrl` 解析播放地址
