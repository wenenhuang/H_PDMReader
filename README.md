# Mini PDM Reader

一个简易的 PowerDesigner PDM 文件阅读器工具。

## 功能特性

- 上传并解析 .pdm 文件
- 提取表信息、字段信息和外键关系
- 前端展示表列表和字段详情
- 全局搜索功能
- 导出数据字典为 Excel (.xlsx)
- 导出数据字典为 Markdown
- 简单 ER 图展示

## 技术栈

- 前端：Vue 3 + Vite + Element Plus
- 后端：Node.js + Express
- 解析：xml2js
- 导出：exceljs

## 安装和运行

### 后端

```bash
cd backend
npm install
npm start
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

### 启动应用

1. 启动后端服务器（端口 3000）
2. 启动前端开发服务器（端口 5173，默认）
3. 在浏览器中打开 http://localhost:5173

## 使用说明

1. 点击"上传 PDM 文件"按钮，选择 .pdm 文件
2. 文件上传后，左侧显示表列表
3. 点击表名查看字段详情
4. 使用搜索框搜索表名、字段名或注释
5. 点击导出按钮下载 Excel 或 Markdown 文件
6. 查看右侧的简单 ER 图

## 注意事项

- PDM 文件需为 PowerDesigner 生成的 XML 格式
- 解析基于常见 PDM 结构，如有特殊格式可能需调整解析逻辑
- ER 图为简化展示，仅显示表节点