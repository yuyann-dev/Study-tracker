#!/usr/bin/env python3
"""
构建 Study Tracker 完整 git 提交历史（v1 - v18 全部版本）
"""
import os
import shutil
import subprocess
import zipfile

# 路径配置
SRC_D = r"D:\喻颜资料\大学资料\Studytracker项目\源代码"
SRC_C_V14 = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\Study-tracker-v14-fullstack.zip"
SRC_C_V17 = r"C:\Users\MXyuan\Doubao\chats\2026-10-01\new-chat\Study-tracker-v17-fullstack.zip"
PROJECT_DIR = r"C:\Users\MXyuan\Doubao\chats\2026-10-03\new-chat-2"
GIT_DIR = os.path.join(PROJECT_DIR, "study-tracker-repo")
CURRENT_DIR = PROJECT_DIR  # 当前版本的 frontend/backend 目录

# 版本定义：(标签名, 源文件路径, 提交信息, 日期)
# 单 html 文件版本会自动模拟 frontend/index.html 结构
VERSIONS = [
    ("v1", os.path.join(SRC_D, "Study-tracker.html"),
     "feat: v1 初始版本 - 单页学习记录应用", "2026-09-15"),
    ("v2", os.path.join(SRC_D, "Study-tracker-v2.html"),
     "feat: v2 功能迭代 - 扩展学习记录功能", "2026-09-16"),
    ("v3", os.path.join(SRC_D, "Study-tracker-v3.html"),
     "feat: v3 功能迭代 - 优化交互与数据结构", "2026-09-17"),
    ("v4", os.path.join(SRC_D, "Study-tracker-v4.html"),
     "feat: v4 功能迭代 - 完善刷题与错题模块", "2026-09-18"),
    ("v5", os.path.join(SRC_D, "Study-tracker-v5.html"),
     "feat: v5 功能迭代 - 新增背书模块与复习算法", "2026-09-19"),
    ("v6", os.path.join(SRC_D, "Study-tracker-v6（苹果数据防护）.html"),
     "feat: v6 新增苹果数据防护机制\n\niOS Safari 数据丢失防护，localStorage 持久化存储，页面隐藏时自动保存", "2026-09-20"),
    ("v7", os.path.join(SRC_D, "Study-tracker-v7（苹果数据防护＋备份弹窗保护）.html"),
     "feat: v7 新增备份弹窗保护\n\n检测到存储异常时弹窗提醒用户导出备份，防止数据丢失", "2026-09-21"),
    ("v8", os.path.join(SRC_D, "Study-tracker-v8.html"),
     "feat: v8 功能迭代 - PWA 支持与深色模式", "2026-09-22"),
    ("v9", os.path.join(SRC_D, "Study-tracker-v9.html"),
     "feat: v9 功能迭代 - 全设备响应式适配", "2026-09-24"),
    ("v10", os.path.join(SRC_D, "Study-tracker-v10.html"),
     "feat: v10 功能迭代 - 错题标签与薄弱点分析", "2026-09-26"),
    ("v11", os.path.join(SRC_D, "Study-tracker-v11.zip"),
     "feat: v11 功能完善版本\n\n- 刷题本（习题册/套卷模式）\n- 错题本（三种模式+标签+薄弱点分析）\n- 背书模块（经典间隔/均匀分布模式）\n- PWA 支持（manifest + service worker）\n- 深色模式\n- 全设备适配", "2026-09-28"),
    ("v12", os.path.join(SRC_D, "Study-tracker-v12-fullstack.html"),
     "feat: v12 全栈原型 - 前后端整合单文件版本", "2026-09-29"),
    ("v13", os.path.join(SRC_D, "Study-tracker-v13-fullstack.zip"),
     "feat: v13 全栈版本 - 加入后端服务\n\n- Node.js Express + better-sqlite3 后端\n- 邮箱验证码注册登录\n- JWT 鉴权\n- 云端数据自动同步\n- 管理员面板", "2026-09-30"),
    ("v14", SRC_C_V14,
     "feat: v14 全栈迭代 - 同步算法与安全加固", "2026-10-01"),
    ("v15", os.path.join(SRC_D, "Study-tracker-v15-fullstack.zip"),
     "feat: v15 稳定版本\n\n- 服务端对称合并算法（syncMerge）\n- 墓碑机制防止删除复活\n- 存储配额限制（单用户5MB/总量50MB）\n- 管理员面板增强（用户管理/邀请码/审计/系统监控）\n- CSP 内容安全策略\n- 邮件告警", "2026-10-01"),
    ("v17", SRC_C_V17,
     "feat: v17 视觉定稿版本\n\n- 视觉品牌定稿（纸感学院派方案B）\n- 哑光墨绿主色 + 暖纸底/哑光蓝灰深色\n- 品牌图标（S丝带+学位帽+书本）\n- 性能优化（gzip_static、ETag缓存）\n- 安全加固（bcrypt、CORS白名单、限流）", "2026-10-02"),
]

def run_git(args):
    result = subprocess.run(["git"] + args, cwd=GIT_DIR,
                          capture_output=True, text=True, encoding='utf-8')
    return result

def extract_version(source_path):
    """解压/复制版本到临时目录，返回项目文件路径"""
    temp_dir = os.path.join(GIT_DIR, ".temp_version")
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir)

    if source_path.endswith('.zip'):
        with zipfile.ZipFile(source_path, 'r') as z:
            z.extractall(temp_dir)
        # 找到实际的项目目录（可能有一层子目录）
        items = os.listdir(temp_dir)
        if len(items) == 1 and os.path.isdir(os.path.join(temp_dir, items[0])):
            return os.path.join(temp_dir, items[0])
        return temp_dir
    else:
        # 单 html 文件，模拟前端目录结构
        frontend_dir = os.path.join(temp_dir, "frontend")
        os.makedirs(frontend_dir)
        shutil.copy2(source_path, os.path.join(frontend_dir, "index.html"))
        return temp_dir

def copy_to_git(src_dir):
    """将版本文件复制到 git 工作目录"""
    for item in os.listdir(GIT_DIR):
        if item == '.git' or item.startswith('.temp'):
            continue
        path = os.path.join(GIT_DIR, item)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

    for item in os.listdir(src_dir):
        src = os.path.join(src_dir, item)
        dst = os.path.join(GIT_DIR, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)

def create_gitignore():
    gitignore = """# 依赖
node_modules/

# 环境变量（含密钥，绝不提交）
.env
.env.*

# 数据库
backend/data/
*.db
*.db-journal
*.db-wal
*.db-shm

# 日志
backend/logs/
*.log
npm-debug.log*

# 上传文件
backend/uploads/

# 备份
backups/
*.bak
*.backup

# 预压缩文件（部署时生成）
*.gz

# 系统文件
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# 临时文件
tmp/
temp/
*.tmp
"""
    with open(os.path.join(GIT_DIR, ".gitignore"), 'w', encoding='utf-8') as f:
        f.write(gitignore)

def main():
    print("=== 开始构建 Study Tracker 完整 Git 历史（v1-v18）===\n")

    if os.path.exists(GIT_DIR):
        shutil.rmtree(GIT_DIR)
    os.makedirs(GIT_DIR)

    run_git(["init"])
    run_git(["config", "user.name", "Yu Yan"])
    run_git(["config", "user.email", "yuyan@yystudy.top"])
    run_git(["config", "core.autocrlf", "input"])

    create_gitignore()

    for tag_name, source_path, commit_msg, date in VERSIONS:
        if not os.path.exists(source_path):
            print(f"  文件不存在，跳过 {tag_name}: {source_path}")
            continue

        print(f"处理 {tag_name}...")
        version_dir = extract_version(source_path)
        copy_to_git(version_dir)
        create_gitignore()

        run_git(["add", "-A"])
        result = run_git(["commit", "-m", commit_msg,
                          "--date", f"{date}T12:00:00+08:00"])
        if result.returncode == 0:
            print(f"  已提交: {tag_name}")
        else:
            print(f"  无变化（可能与上一版本相同）: {tag_name}")

        run_git(["tag", tag_name])
        print(f"  已打标签: {tag_name}\n")

    # 当前版本（v18）
    print("处理 v18（当前版本）...")
    copy_to_git(CURRENT_DIR)
    create_gitignore()

    # 复制 README（从当前 git 目录的上一个版本保留）
    # README 已经在 CURRENT_DIR 里了吗？不在，需要单独复制
    readme_src = os.path.join(PROJECT_DIR, "study-tracker-git-backup", "README.md")
    # 直接用当前目录的 README（如果存在）
    current_readme = os.path.join(CURRENT_DIR, "README.md")
    if os.path.exists(current_readme):
        shutil.copy2(current_readme, os.path.join(GIT_DIR, "README.md"))

    current_commit = """fix: v18 修复图标更新与同步性能问题

- 图标 cache-busting：SW 升级 v20，所有图标引用加 ?v=2
  修复安卓 PWA 启动器图标清理缓存后仍不更新的问题
- scheduleCloudSync 丢同步 bug：新增 syncPending 机制
  同步进行中又有新变更时标记，当前同步结束后自动补一次
- ETag 304 增量同步：前后端支持 If-None-Match
  服务端数据未变时返回 304，省掉全量 JSON 下载
- 修复重复 controllerchange 监听器导致首次安装不必要刷新
- triggerSync 同步中不再直接丢弃请求，改为排队等待
- 登出/401 时清除 ETag 状态，切换账号后重新全量拉取
- shimmer 骨架条美化：匹配真实列表项布局，同步加载更优雅
"""
    run_git(["add", "-A"])
    run_git(["commit", "-m", current_commit])
    run_git(["tag", "v18"])
    print("  已提交 v18，标签 v18\n")

    # README 单独提交
    print("添加 README...")
    readme_path = os.path.join(GIT_DIR, "README.md")
    if not os.path.exists(readme_path):
        # 从项目目录复制
        src_readme = os.path.join(PROJECT_DIR, "study-tracker-git", "README.md")
        if os.path.exists(src_readme):
            shutil.copy2(src_readme, readme_path)

    if os.path.exists(readme_path):
        run_git(["add", "README.md"])
        run_git(["commit", "-m", "docs: 添加项目 README 文档（功能介绍、技术栈、部署说明、版本历史）"])
        print("  README 已提交\n")

    print("=== Git 历史构建完成 ===")
    result = run_git(["log", "--oneline", "--graph", "--all", "--date=short",
                       "--pretty=format:%h %ad %s"])
    print(result.stdout)

    print(f"\n标签数量: ", end="")
    result = run_git(["tag"])
    tags = [t for t in result.stdout.strip().split('\n') if t]
    print(len(tags))
    print("标签列表:")
    for t in sorted(tags):
        print(f"  {t}")

    print(f"\n仓库位置: {GIT_DIR}")

if __name__ == "__main__":
    main()
