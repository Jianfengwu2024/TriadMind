# TriadMind Dummy User Guide

这是一份给“零基础第一次上手”的速用版。

---

## 1. 先做初始化

```bash
triadmind init
triadmind bootstrap doctor --json
```

如果 `doctor` 不通过：

```bash
triadmind bootstrap init --force
```

---

## 2. 每个新窗口先跑 bootstrap

```bash
# Linux / macOS
bash .triadmind/session-bootstrap.sh

# Windows PowerShell
.\.triadmind\session-bootstrap.ps1
```

---

## 3. 开发一条需求时就按这个顺序

```bash
triadmind sync --force
triadmind runtime --visualize --view full
triadmind coverage --json
triadmind view-map --json
triadmind plan --no-open --view architecture
triadmind apply
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 4. 你最该看哪几个文件

- `.triadmind/triad-map.json`
- `.triadmind/runtime-map.json`
- `.triadmind/view-map.json`
- `.triadmind/runtime-diagnostics.json`
- `.triadmind/bootstrap-verify.json`
- `.triadmind/govern-report.json`

---

## 5. 项目目录不一样怎么办

不要改核心源码，先改：

```text
.triadmind/profile.json
```

把你的分类、扫描域、语言适配器写进去。

---

## 6. 一条最小验收命令

```bash
triadmind bootstrap doctor --json && triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```
