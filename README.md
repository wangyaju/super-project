# super-project

[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

super-project 是一个基于 Node.js 的项目骨架，用于验证和演示 super agent 在 GitHub 上的协作流程。仓库目前包含开发环境约定、共建指南、Git 忽略规则和开源许可证，应用代码会随 Issue 逐步补充。

## 仓库内容

仓库目前只包含项目骨架，还没有应用代码和 `package.json`：

| 文件 | 说明 |
| --- | --- |
| `README.md` | 项目说明、开发环境与协作约定 |
| `CONTRIBUTING.md` | 共建指南：问题反馈、开发流程与评审规则 |
| `LICENSE` | MIT 许可证 |
| `.gitignore` | Node.js 项目的忽略规则 |

## 开发环境

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | 22 LTS 或更高版本 | 推荐使用当前 LTS 版本 |
| npm | 10 或更高版本 | 随 Node.js 一并安装，也可以改用 pnpm |
| Git | 2.40 或更高版本 | 克隆仓库与提交代码 |

可选工具：

- nvm 或 nvm-windows：在多个 Node.js 版本之间切换
- VS Code：安装 ESLint 和 Prettier 扩展，保持代码风格一致

在终端中执行以下命令确认环境：

```bash
node -v
npm -v
git --version
```

## 快速开始

```bash
git clone https://github.com/wangyaju/super-project.git
cd super-project
```

仓库暂无应用源码和依赖，克隆后即可阅读文档。应用代码加入后，安装依赖和启动项目的命令会补充到本节。

## 协作流程

1. 在 [Issues](https://github.com/wangyaju/super-project/issues) 中描述需求或问题。
2. 从 `main` 创建分支，建议命名为 `feat/<主题>` 或 `fix/<主题>`。
3. 提交变更并发起 Pull Request，在描述中关联对应的 Issue。
4. 评审和检查通过后合并到 `main`。

## 参与贡献

欢迎参与共建。提交 Issue 或 Pull Request 前，请阅读 [共建指南](CONTRIBUTING.md)，其中说明了问题反馈、分支命名、提交信息规范、PR 检查和评审流程。

- 缺陷和功能建议请通过 [Issues](https://github.com/wangyaju/super-project/issues) 提出
- 代码和文档改动请通过 Pull Request 提交
- 参与讨论时请遵守共建指南中的行为准则

## 许可证

本项目基于 [MIT License](LICENSE) 开源，Copyright (c) 2026 wangyaju。

## 相关链接

- [共建指南](CONTRIBUTING.md)
- [Issues](https://github.com/wangyaju/super-project/issues)
- [Pull Requests](https://github.com/wangyaju/super-project/pulls)
