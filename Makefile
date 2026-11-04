# Short names for the Web and Desktop application commands. The package.json
# scripts they call stay the source of truth; docs/development.md documents both.
.DEFAULT_GOAL := help
.PHONY: help build clean web desktop dev-web dev-desktop \
        reload check deva devb switch

PNPM ?= pnpm
ARGS ?=

# 本机部署（个人 fork 专用，见 CLAUDE.local.md）：pm2 托管的 dsh-web。
# 浏览器里的 UI 来自构建产物，所以"生效"必须 build 之后再重启，只有重启是不够的。
DSH_PM2 ?= dsh-web
DSH_PORT ?= 3080
DSH_GATE ?= niubilasa
DSH_PM2_CONFIG ?= $(HOME)/.mine/dsh-web.pm2.config.cjs

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make clean        pnpm run clean           remove build outputs and safe deleted-package residue"
	@echo "make web          pnpm run start:web       serve the built Web artifacts from source"
	@echo "make desktop      pnpm run start:desktop   launch the built Desktop artifacts"
	@echo "make dev-web      pnpm run dev:web         build, serve, and rebuild Web on source edits"
	@echo "make dev-desktop  pnpm run dev:desktop     build, then launch Desktop"
	@echo "ARGS='--no-open --port 3081' forwards options to the launched application;"
	@echo "the Web commands accept dsh web flags, the Desktop launcher accepts none."
	@echo ""
	@echo "本机（pm2 托管的 dsh-web）："
	@echo "make reload       全量构建 → 重启 dsh-web → 校验前端产物已换新"
	@echo "make deva         git checkout deva 后同上（工作区不干净会拒绝）"
	@echo "make devb         git checkout devb 后同上"
	@echo "make switch BRANCH=deva|devb   等价于 make deva / make devb"
	@echo "make check        只校验服务端产物 == 仓库产物，不构建不重启"

build:
	$(PNPM) run build

clean:
	$(PNPM) run clean

web:
	$(PNPM) run start:web $(ARGS)

desktop:
	$(PNPM) run start:desktop $(ARGS)

dev-web:
	$(PNPM) run dev:web $(ARGS)

dev-desktop:
	$(PNPM) run dev:desktop $(ARGS)

# ---- 本机部署目标（个人 fork 专用）------------------------------------------
#
# reload 做三件事，顺序不能换：
#   1. pnpm run build —— 出 packages/client/*/lib/client.js 与 apps/web/dist。
#      只 pm2 restart 换的是 host 侧源码，UI 永远不会更新（2026-10-18 踩过）。
#      `env -u NODE_OPTIONS`：pm2 启动脚本给进程设的 --import tsx/esm 会让 tsdown
#      的配置加载返回 null 直接失败，从 pm2 长出来的 shell（含 agent 会话）会继承。
#   2. 重启 —— host 启动时缓存插件清单与 rev=，必须先构建再重启。
#   3. 校验 —— 服务端下发的 assets/index-*.js 必须等于仓库刚构建的那个。
reload:
	@unset NODE_OPTIONS; \
	echo "▶ 全量构建"; \
	$(PNPM) run build || { echo "❌ 构建失败，未重启"; exit 1; }; \
	echo "▶ 重启 $(DSH_PM2)"; \
	if pm2 describe $(DSH_PM2) >/dev/null 2>&1; then pm2 restart $(DSH_PM2) >/dev/null; \
	else pm2 start $(DSH_PM2_CONFIG) >/dev/null; fi; \
	sleep 3; \
	curl -s -o /dev/null -w "  暗号路径 HTTP %{http_code}\n" "http://127.0.0.1:$(DSH_PORT)/$(DSH_GATE)"; \
	curl -s -b "dsh-gate=$(DSH_GATE)" -o /tmp/dsh-make-index.html "http://127.0.0.1:$(DSH_PORT)/"; \
	served=$$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' /tmp/dsh-make-index.html | head -1); \
	built=$$(ls -t apps/web/dist/assets/index-*.js | head -1 | xargs basename); \
	echo "  服务端下发: $${served:-（取不到）}"; \
	echo "  仓库产物:   assets/$$built"; \
	if [ "assets/$$built" = "$$served" ]; then echo "✅ 一致：前端跑的就是当前源码构建的产物"; \
	else echo "❌ 不一致：产物没换新"; exit 1; fi

check:
	@curl -s -b "dsh-gate=$(DSH_GATE)" -o /tmp/dsh-make-index.html "http://127.0.0.1:$(DSH_PORT)/"; \
	served=$$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' /tmp/dsh-make-index.html | head -1); \
	built=$$(ls -t apps/web/dist/assets/index-*.js | head -1 | xargs basename); \
	echo "  服务端下发: $${served:-（取不到）}"; \
	echo "  仓库产物:   assets/$$built"; \
	if [ "assets/$$built" = "$$served" ]; then echo "✅ 一致"; else echo "❌ 不一致，跑 make reload"; exit 1; fi

# 切分支后全量重启。工作区有未提交改动就拒绝，避免把改动带过去或切一半。
deva devb:
	@n=$$(git status --porcelain | grep -v '^?? .tmp/' | wc -l | tr -d ' '); \
	if [ "$$n" != "0" ]; then echo "❌ 工作区有 $$n 项未提交改动，先处理再切分支"; exit 1; fi
	git checkout $@
	@$(MAKE) --no-print-directory reload

switch:
	@case "$(BRANCH)" in deva|devb) ;; *) echo "用法：make switch BRANCH=deva|devb"; exit 1;; esac
	@$(MAKE) --no-print-directory $(BRANCH)
