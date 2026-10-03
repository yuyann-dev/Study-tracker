#!/usr/bin/env python3
"""
构建 Study Tracker 完整 git 提交历史
按版本时间顺序：v1 -> v6 -> v7 -> v11 -> v13 -> v15 -> v17 -> 当前版本
"""
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

# 路径配置
SRC_DIR = r"D:\喻颜资料\大学资料\Studytracker项目\源代码"
PROJECT_DIR = r"C:\Users\MXyuan\Doubao\chats\2026-10-03\new-chat-2"
GIT_DIR = os.path.join(PROJECT_DIR, "study-tracker-git")

# 版本定义：(版本名, 源文件/目录, 提交信息, 日期)
VERSIONS = [
    ("v1-初始版本", "Study-tracker.html", 
     "feat: 初始版本 - 单页学习记录应用\n\n基础 HTML/CSS/JS 单文件应用，支持学习数据本地存储",
     "2026-09-15"),
    ("v6-苹果数据防护", "Study-tracker-v6（苹果数据防护）.html",
     "feat: 新增苹果数据防护机制\n\niOS Safari 数据丢失防护，localStorage 持久化存储，页面隐藏时自动保存",
     "2026-09-20"),
    ("v7-备份弹窗保护", "Study-tracker-v7（苹果数据防护＋备份弹窗保护）.html",
     "feat: 新增备份弹窗保护\n\n检测到存储异常时弹窗提醒用户导出备份，防止数据丢失",
     "2026-09-21"),
    ("v11-功能完善", "Study-tracker-v11.zip",
     "feat: v11 功能完善版本\n\n- 刷题本（习题册/套卷模式）\n- 错题本（三种模式+标签+薄弱点分析）\n- 背书模块（经典间隔/均匀分布模式）\n- PWA 支持（manifest + service worker）\n- 深色模式\n- 全设备适配",
     "2026-09-28"),
    ("v13-全栈版本", "Study-tracker-v13-fullstack.zip",
     "feat: v13 全栈版本 - 加入后端服务\n\n- Node.js Express + better-sqlite3 后端\n- 邮箱验证码注册登录\n- JWT 鉴权\n- 云端数据自动同步\n- 管理员面板",
     "2026-09-30"),
    ("v15-稳定版本", "Study-tracker-v15-fullstack.zip",
     "feat: v15 稳定版本\n\n- 服务端对称合并算法（syncMerge）\n- 墓碑机制防止删除复活\n- 存储配额限制（单用户5MB/总量50MB）\n- 管理员面板增强（用户管理/邀请码/审计/系统监控）\n- CSP 内容安全策略\n- 邮件告警",
     "2026-10-01"),
    ("v17-最新全栈", "Study-tracker-v17-fullstack.zip",
     "feat: v17 最新全栈版本\n\n- 视觉品牌定稿（纸感学院派方案B）\n- 哑光墨绿主色 + 暖纸底/哑光蓝灰深色\n- 品牌图标（S丝带+学位帽+书本）\n- 性能优化（gzip_static、ETag缓存）\n- 安全加固（bcrypt、CORS白名单、限流）",
     "2026-10-02"),
]

def run_git(args, cwd=None):
    """运行 git 命令"""
    result = subprocess.run(["git"] + args, cwd=cwd or GIT_DIR, 
                          capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        print(f"  GIT ERROR: {result.stderr}")
    return result

def extract_version(version_name, source_path):
    """解压/复制版本到临时目录，返回项目文件路径"""
    temp_dir = os.path.join(GIT_DIR, ".temp_version")
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir)
    
    src = os.path.join(SRC_DIR, source_path)
    
    if source_path.endswith('.zip'):
        with zipfile.ZipFile(src, 'r') as z:
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
        shutil.copy2(src, os.path.join(frontend_dir, "index.html"))
        return temp_dir

def copy_to_git(src_dir):
    """将版本文件复制到 git 工作目录"""
    # 清空工作目录（保留 .git）
    for item in os.listdir(GIT_DIR):
        if item == '.git' or item.startswith('.temp'):
            continue
        path = os.path.join(GIT_DIR, item)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
    
    # 复制新版本文件
    for item in os.listdir(src_dir):
        src = os.path.join(src_dir, item)
        dst = os.path.join(GIT_DIR, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)

def create_gitignore():
    """创建 .gitignore"""
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
    print("=== 开始构建 Study Tracker Git 历史 ===\n")
    
    # 初始化 git 仓库
    if os.path.exists(GIT_DIR):
        shutil.rmtree(GIT_DIR)
    os.makedirs(GIT_DIR)
    
    run_git(["init"])
    run_git(["config", "user.name", "Yu Yan"])
    run_git(["config", "user.email", "yuyan@yystudy.top"])
    run_git(["config", "core.autocrlf", "input"])
    
    create_gitignore()
    
    # 按版本顺序提交
    for version_name, source_path, commit_msg, date in VERSIONS:
        print(f"处理 {version_name}...")
        
        src_full = os.path.join(SRC_DIR, source_path)
        if not os.path.exists(src_full):
            print(f"  文件不存在，跳过: {source_path}")
            continue
        
        # 解压/复制版本
        version_dir = extract_version(version_name, source_path)
        
        # 复制到 git 工作目录
        copy_to_git(version_dir)
        
        # 确保 .gitignore 存在
        create_gitignore()
        
        # 添加并提交
        run_git(["add", "-A"])
        result = run_git(["commit", "-m", commit_msg, 
                          "--date", f"{date}T12:00:00+08:00"])
        if result.returncode == 0:
            print(f"  已提交: {version_name}")
        else:
            print(f"  提交可能无变化: {version_name}")
        
        # 打 tag
        run_git(["tag", version_name])
        print(f"  已打标签: {version_name}\n")
    
    # 当前版本（从项目目录复制）
    print("处理当前版本（本次修改）...")
    current_dir = os.path.join(PROJECT_DIR)
    # 只复制 frontend 和 backend 目录
    copy_to_git(current_dir)
    create_gitignore()
    
    current_commit = """fix: 修复图标更新与同步性能问题

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
    run_git(["tag", "v18-current"])
    print("  已提交当前版本，标签 v18-current\n")
    
    # 显示最终日志
    print("=== Git 历史构建完成 ===")
    result = run_git(["log", "--oneline", "--graph", "--all"])
    print(result.stdout)
    
    print(f"\n仓库位置: {GIT_DIR}")
    print("标签:")
    result = run_git(["tag", "-l"])
    print(result.stdout)

if __name__ == "__main__":
    main()
