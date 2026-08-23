# 捏捏宠 · Nienie Pet

一个可以直接拖、捏、旋转的 3D 角色实验，同时支持网页工作台与 Electron 透明桌宠窗口。

项目包含三种实时交互模式：软体回弹、橡皮泥定型，以及基于 Canvas UI `LiquidObject` 的液体折射效果。

## 功能

- **捏捏**：拖动模型局部网格，松手后通过软体约束恢复原状。
- **橡皮泥**：沿用软体变形手感，松手时保留当前造型。
- **液体**：指针移动会扰动流体场，点击产生冲击，拖动可环绕旋转模型。
- **网页工作台**：模式切换、深浅主题、恢复原样与截图保存。
- **透明桌宠**：无边框透明窗口、窗口置顶、托盘隐藏和鼠标穿透。
- **触控支持**：软体模式支持双指捏拉，液体模式支持触控旋转。
- **减少动态效果**：响应系统的 `prefers-reduced-motion` 设置。

## 实现思路

### 捏捏与橡皮泥

模型加载后会从网格构建粒子和结构约束。拖拽时使用射线检测定位抓取区域，再由 XPBD 风格的软体求解器逐帧更新顶点位置。

- 捏捏模式使用更强的回弹参数，松手后恢复初始形状。
- 橡皮泥模式使用更柔软的参数，并在松手时把当前结果烘焙为新的静止形状。

### 液体

液体模式封装了 [Canvas UI LiquidObject](https://canvasui.dev/docs/components/liquid-object)，利用 WebGL 后处理实现折射、色差、涡流、颗粒和晃动效果，同时启用轨道控制实现拖拽旋转。

## 技术栈

- React 19 + TypeScript
- Three.js
- Vite
- Electron
- Canvas UI LiquidObject

## 开始使用

### 环境要求

- Node.js 20.19+ 或 22.12+
- npm
- 支持 WebGL 的浏览器或显卡环境

### 安装

```bash
git clone <your-repository-url>
cd nienie-pet
npm install
```

### 准备角色资源

仓库不会包含演示角色资源。请使用你拥有版权或正式授权的文件，并放到以下位置：

```text
public/
├── assets/
│   └── nailong.glb
└── icon.png
```

当前代码默认读取 `public/assets/nailong.glb`，Electron 托盘默认读取 `public/icon.png`。如需使用其他名称，请同步修改 `src/App.tsx` 与 `electron/main.mjs`。

### 启动网页开发环境

```bash
npm run dev
```

打开 `http://127.0.0.1:5173/`。

### 启动桌宠开发环境

```bash
npm run desktop:dev
```

### 构建与本地桌宠预览

```bash
npm run build
npm run desktop
```

## 可用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 网页开发服务器 |
| `npm run desktop:dev` | 同时启动 Vite 与 Electron 桌宠 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |
| `npm run build` | 类型检查并生成网页生产构建 |
| `npm run desktop` | 构建后启动 Electron 桌宠 |

## 项目结构

```text
nienie-pet/
├── electron/                    # Electron 主进程与预加载脚本
├── public/                      # 本地角色模型与桌宠图标
├── src/
│   ├── components/
│   │   ├── canvasui/            # Canvas UI LiquidObject 组件
│   │   ├── LiquidViewport.tsx   # 液体模式封装
│   │   └── ModelViewport.tsx    # 软体模式 React 封装
│   ├── three/
│   │   ├── PetScene.ts          # Three.js 场景、交互与渲染循环
│   │   └── SoftBodySolver.ts    # 软体粒子与约束求解
│   ├── App.tsx                  # 页面、模式和桌宠界面
│   └── styles.css               # 网页与透明桌宠样式
├── THIRD_PARTY_NOTICES.md
└── vite.config.ts
```

## 桌宠操作

- 拖动窗口顶部区域可移动桌宠窗口。
- 点击图钉可切换窗口置顶。
- 点击隐藏按钮或托盘菜单可隐藏桌宠。
- 使用托盘菜单可启用鼠标穿透。
- 按 `Ctrl/Cmd + Alt + N` 可显示或隐藏窗口。

## 素材与许可证说明

本地调试曾使用哔哩哔哩[万梗捏](https://www.bilibili.com/toy/MemeMash/index.html)页面中的奶龙素材。该模型与图标仅用于技术验证，已通过 `.gitignore` 排除，不随仓库分发。发布或二次分发前，请替换为自有或已获正式授权的角色资源。

液体模式使用 Canvas UI 的 `LiquidObject` React 组件。其来源、许可条件和版权声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

除上述第三方组件外，本仓库暂未附加项目级开源许可证；未经许可，不代表授予复制、修改或分发本项目代码的权利。
