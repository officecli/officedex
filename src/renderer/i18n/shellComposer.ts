/**
 * Shell copy that used to be hardcoded English in `src/shell` / `src/canvas`.
 * Kept in its own module so en.ts / zh.ts (shared by several in-flight tracks)
 * are not the only place shell strings can land. Merged in `index.tsx`.
 */
export const shellComposerEn: Record<string, string> = {
  // Composer — permissions
  "shell.cx.permission.menu": "Permissions",
  "shell.cx.permission.title": "Permission: {name}",
  "shell.cx.permission.full": "Full access",
  "shell.cx.permission.fullDescription": "Apply edits inside this folder",
  "shell.cx.permission.reviewDescription": "Nothing is applied without you",
  "shell.cx.permission.custom": "Custom",
  "shell.cx.permission.customDescription": "Use your own instructions",
  "shell.cx.permission.notBuilt":
    "{mode} is not available yet — every run applies its changes directly. Full access is the only mode the agent honours.",

  // Composer — what this message makes
  "shell.cx.output.menu": "What this message makes",
  "shell.cx.output.docDescription": "A Word file (.docx)",
  "shell.cx.output.sheetDescription": "An Excel file (.xlsx)",
  "shell.cx.output.slidesDescription": "A PowerPoint file (.pptx)",
  "shell.cx.output.editFile": "Edit {name}",
  "shell.cx.output.editFileDescription": "Change the document on screen",
  "shell.cx.output.auto": "Decide from my instruction",
  "shell.cx.output.autoDescription": "Read the type off what I asked for",
  "shell.cx.output.autoName": "Auto",
  "shell.cx.output.autoTitle": "The type is read off your instruction. Pick one to be sure.",
  "shell.cx.output.newFile": "New file",
  "shell.cx.output.newFileDescription": "new file",
  "shell.cx.output.createsTitle": "This message creates a {description}",
  "shell.cx.output.editsTitle": "This message edits {name}",

  // Composer — task scope
  "shell.cx.scope.menu": "Task scope",
  "shell.cx.scope.title": "Scope: {name}",
  "shell.cx.scope.none": "none",
  "shell.cx.scope.newFolder": "New folder…",
  "shell.cx.scope.newFolderDescription": "Create one and scope this message to it",

  // Composer — input
  "shell.cx.placeholder.home": "Ask anything, @ to add files or folders…",
  "shell.cx.placeholder.homeImage": "Describe your image, or use @ to add files or folders…",
  "shell.cx.placeholder.imageVersion": "Describe changes to Version {version}…",
  "shell.cx.placeholder.task": "Message Agent, @ files or folders…",
  "shell.cx.aria.newTask": "New task instructions",
  "shell.cx.aria.messageAgent": "Message Agent",

  // Composer — chips
  "shell.cx.reference.remove": "Remove the reference to {name}",
  "shell.cx.chip.remove": "Remove {name}",
  "shell.cx.chip.fileCount": " · {count} files",

  // Composer — attachments
  "shell.cx.addFiles": "Add files or folders",
  "shell.cx.attach.tooBig": "{name} is larger than 20 MB.",
  "shell.cx.attach.max": "You can attach up to {count} items.",
  "shell.cx.attach.onlyFirst": "Only the first {count} files were attached.",
  "shell.cx.attach.uploadedFolder": "Uploaded folder",
  "shell.cx.drop": "Drop files to add context",

  // Composer — dictation
  "shell.cx.dictate": "Dictate",
  "shell.cx.dictateStop": "Stop dictation",
  "shell.cx.dictateListening": "Listening — press to stop",
  "shell.cx.dictateUnavailable":
    "Dictation is not available in this browser. Type your instruction for now.",
  "shell.cx.dictateFailed": "Dictation could not start.",

  // Composer — send, mode and Enter behaviour
  "shell.cx.generateImage": "Generate image",
  "shell.cx.send": "Send message",
  "shell.cx.stop": "Stop task",
  "shell.cx.enterOn": "Enter sends · on",
  "shell.cx.enterOff": "Enter sends · off",
  "shell.cx.enterDescription": "Shift + Enter adds a new line",

  // Mention menu
  "shell.mention.heading": "Files and folders",
  "shell.mention.uploadFiles": "Upload files",
  "shell.mention.uploadFilesDescription": "Choose files from this computer",
  "shell.mention.uploadFolder": "Upload folder",
  "shell.mention.uploadFolderDescription": "Include the files inside a folder",
  "shell.mention.fromComputer": "From this computer",
  "shell.mention.fileCount": "{count} files",
  "shell.mention.empty": "Nothing matches “{query}”.",
  "shell.mention.footer": "↑ ↓ navigate · ↵ select · esc close",

  // Model menu
  "shell.modelMenu.menu": "Model",
  "shell.modelMenu.title": "Model: {name}",
  "shell.modelMenu.none": "none",
  "shell.modelMenu.noModel": "No model",
  "shell.modelMenu.edit": "Edit {name}…",
  "shell.modelMenu.editDescription": "Change its endpoint, key or display name",
  "shell.modelMenu.replace": "Replace custom model…",
  "shell.modelMenu.replaceDescription": "Only one fits — this drops {name}",
  "shell.modelMenu.add": "Add model…",
  "shell.modelMenu.addDescription": "Point the shell at your own endpoint",
  "shell.modelMenu.dialogEdit": "Edit model",
  "shell.modelMenu.dialogAdd": "Add model",
  "shell.modelMenu.save": "Save model",
  "shell.modelMenu.note":
    "The shell only records which model you picked. Where the key is kept is the desktop app’s decision — nothing is stored in this window.",
  "shell.modelMenu.replacesLead": "Saving this replaces",
  "shell.modelMenu.replacesTail": ". Only one custom model can be configured at a time.",
  "shell.modelMenu.name": "Display name",
  "shell.modelMenu.modelId": "Model ID",
  "shell.modelMenu.provider": "Provider",
  "shell.modelMenu.baseUrl": "Base URL",
  "shell.modelMenu.optional": "optional",
  "shell.modelMenu.apiKey": "API 密钥",
  "shell.modelMenu.apiKeyHint": "not stored by this window",
  "shell.modelMenu.errorName": "Enter a display name.",
  "shell.modelMenu.errorModelId": "Enter the model ID from your provider.",
  "shell.modelMenu.errorModelIdSpaces": "Model ID cannot contain spaces.",
  "shell.modelMenu.errorBaseUrl":
    "Use an http or https URL without credentials or query parameters.",

  // New task menu
  "shell.newTask.menuAria": "New task type",
  "shell.newTask.doc": "Document",
  "shell.newTask.sheet": "Spreadsheet",
  "shell.newTask.slides": "Presentation",
  "shell.newTask.image": "Image",
};

export const shellComposerZh: Record<string, string> = {
  // Composer — permissions
  "shell.cx.permission.menu": "权限",
  "shell.cx.permission.title": "权限：{name}",
  "shell.cx.permission.full": "完全访问",
  "shell.cx.permission.fullDescription": "直接在这个文件夹里应用改动",
  "shell.cx.permission.reviewDescription": "未经你确认不会应用任何改动",
  "shell.cx.permission.custom": "自定义",
  "shell.cx.permission.customDescription": "使用你自己的指令",
  "shell.cx.permission.notBuilt":
    "「{mode}」还没做好——每次运行都会直接应用改动。Agent 目前只认「完全访问」这一种模式。",

  // Composer — what this message makes
  "shell.cx.output.menu": "这条消息产出什么",
  "shell.cx.output.docDescription": "一个 Word 文件（.docx）",
  "shell.cx.output.sheetDescription": "一个 Excel 文件（.xlsx）",
  "shell.cx.output.slidesDescription": "一个 PowerPoint 文件（.pptx）",
  "shell.cx.output.editFile": "编辑 {name}",
  "shell.cx.output.editFileDescription": "改当前屏幕上的这份文档",
  "shell.cx.output.auto": "由我的指令决定",
  "shell.cx.output.autoDescription": "从我的要求里读出类型",
  "shell.cx.output.autoName": "自动",
  "shell.cx.output.autoTitle": "类型是从你的指令里推断的。想确定就自己选一个。",
  "shell.cx.output.newFile": "新建文件",
  "shell.cx.output.newFileDescription": "一个新文件",
  "shell.cx.output.createsTitle": "这条消息会创建{description}",
  "shell.cx.output.editsTitle": "这条消息会改动 {name}",

  // Composer — task scope
  "shell.cx.scope.menu": "任务范围",
  "shell.cx.scope.title": "范围：{name}",
  "shell.cx.scope.none": "无",
  "shell.cx.scope.newFolder": "新建文件夹…",
  "shell.cx.scope.newFolderDescription": "新建一个，并把这条消息的范围定到它",

  // Composer — input
  "shell.cx.placeholder.home": "说说你想做什么，用 @ 添加文件或文件夹…",
  "shell.cx.placeholder.homeImage": "描述你要的图片，或用 @ 添加文件或文件夹…",
  "shell.cx.placeholder.imageVersion": "描述要对版本 {version} 做的改动…",
  "shell.cx.placeholder.task": "给 Agent 发消息，用 @ 引用文件或文件夹…",
  "shell.cx.aria.newTask": "新任务的指令",
  "shell.cx.aria.messageAgent": "给 Agent 发消息",

  // Composer — chips
  "shell.cx.reference.remove": "移除对 {name} 的引用",
  "shell.cx.chip.remove": "移除 {name}",
  "shell.cx.chip.fileCount": " · {count} 个文件",

  // Composer — attachments
  "shell.cx.addFiles": "添加文件或文件夹",
  "shell.cx.attach.tooBig": "{name} 超过 20 MB。",
  "shell.cx.attach.max": "最多只能附加 {count} 项。",
  "shell.cx.attach.onlyFirst": "只附加了前 {count} 个文件。",
  "shell.cx.attach.uploadedFolder": "已上传的文件夹",
  "shell.cx.drop": "把文件拖进来作为上下文",

  // Composer — dictation
  "shell.cx.dictate": "语音输入",
  "shell.cx.dictateStop": "停止语音输入",
  "shell.cx.dictateListening": "正在聆听——点击停止",
  "shell.cx.dictateUnavailable": "这个浏览器不支持语音输入。请先手动输入指令。",
  "shell.cx.dictateFailed": "语音输入没能启动。",

  // Composer — send, mode and Enter behaviour
  "shell.cx.generateImage": "生成图片",
  "shell.cx.send": "发送消息",
  "shell.cx.stop": "停止任务",
  "shell.cx.enterOn": "回车发送 · 开",
  "shell.cx.enterOff": "回车发送 · 关",
  "shell.cx.enterDescription": "Shift + Enter 换行",

  // Mention menu
  "shell.mention.heading": "文件与文件夹",
  "shell.mention.uploadFiles": "上传文件",
  "shell.mention.uploadFilesDescription": "从这台电脑里选文件",
  "shell.mention.uploadFolder": "上传文件夹",
  "shell.mention.uploadFolderDescription": "把文件夹里的文件一起带上",
  "shell.mention.fromComputer": "来自这台电脑",
  "shell.mention.fileCount": "{count} 个文件",
  "shell.mention.empty": "没有匹配“{query}”的结果。",
  "shell.mention.footer": "↑ ↓ 移动 · ↵ 选择 · esc 关闭",

  // Model menu
  "shell.modelMenu.menu": "模型",
  "shell.modelMenu.title": "模型：{name}",
  "shell.modelMenu.none": "无",
  "shell.modelMenu.noModel": "未选择模型",
  "shell.modelMenu.edit": "编辑 {name}…",
  "shell.modelMenu.editDescription": "改它的地址、密钥或显示名称",
  "shell.modelMenu.replace": "替换自定义模型…",
  "shell.modelMenu.replaceDescription": "只能配一个——这会顶掉 {name}",
  "shell.modelMenu.add": "添加模型…",
  "shell.modelMenu.addDescription": "把界面指向你自己的服务地址",
  "shell.modelMenu.dialogEdit": "编辑模型",
  "shell.modelMenu.dialogAdd": "添加模型",
  "shell.modelMenu.save": "保存模型",
  "shell.modelMenu.note":
    "界面只记录你选了哪个模型。密钥存在哪里由桌面端决定——这个窗口不保存任何内容。",
  "shell.modelMenu.replacesLead": "保存后会替换",
  "shell.modelMenu.replacesTail": "。同一时间只能配置一个自定义模型。",
  "shell.modelMenu.name": "显示名称",
  "shell.modelMenu.modelId": "模型 ID",
  "shell.modelMenu.provider": "提供方",
  "shell.modelMenu.baseUrl": "接口地址",
  "shell.modelMenu.optional": "可选",
  "shell.modelMenu.apiKey": "API 密钥",
  "shell.modelMenu.apiKeyHint": "这个窗口不会保存",
  "shell.modelMenu.errorName": "请输入显示名称。",
  "shell.modelMenu.errorModelId": "请输入服务商提供的模型 ID。",
  "shell.modelMenu.errorModelIdSpaces": "模型 ID 不能包含空格。",
  "shell.modelMenu.errorBaseUrl": "请填不带账号密码和查询参数的 http 或 https 地址。",

  // New task menu
  "shell.newTask.menuAria": "新任务类型",
  "shell.newTask.doc": "文档",
  "shell.newTask.sheet": "表格",
  "shell.newTask.slides": "演示",
  "shell.newTask.image": "图片",
};
