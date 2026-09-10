# OfficeDex 内置 Skills

桌面客户端随源代码提供的 AI 生成规则放在此目录。当前包含 `aippt-jssdk-video`，用于“AI 先生成 JSSDK，再由 Host 生成 PPTX 和视频”的流程。

开发版路径：`officedex/skills/aippt-jssdk-video/SKILL.md`

这份文件目前作为桌面端随附资源保存；要让 OfficeCLI 在运行时自动注入，还需要在 Planner/bridge 的 Skill 加载入口中注册该目录。
