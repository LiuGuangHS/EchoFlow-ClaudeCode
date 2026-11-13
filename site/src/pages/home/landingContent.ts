export type LandingLocale = 'zh' | 'en'
export type TaskCategory = 'code' | 'apps' | 'review'
export type FeatureId = 'teams' | 'computer-use' | 'models' | 'workbench' | 'skills'

// Mobile distribution is not verified for EchoFlow; link to availability documentation.
export const MOBILE_LINKS = {
  android: 'https://code.echoflow.cn/desktop/remote',
  testFlight: 'https://code.echoflow.cn/en/desktop/remote'
}

export interface TaskSuggestion {
  label: string
  prompt: string
  category: TaskCategory
}

export interface LandingFeature {
  id: FeatureId
  tab: string
  title: string
  body: string
  route: string
  alt: string
}

export interface LandingContent {
  screenshotNote: string
  hero: {
    eyebrow: string
    // The second line ends with the accent word, which the page sets in the olive accent colour.
    headline: [string, string]
    accent: string
    // Two sentences, one per line on wide screens; the page meta joins them.
    description: [string, string]
    desktopAlt: string
    phoneAlt: string
    phoneLabel: string
  }
  downloads: {
    desktop: string
    android: string
    iphone: string
    androidLabel: string
    iphoneLabel: string
    requirement: string
  }
  mobile: {
    description: string
    abilities: { title: string; body: string }[]
    connection: string
    docs: string
    route: string
    screens: { caption: string; alt: string }[]
  }
  taskSuggestions: TaskSuggestion[]
  features: LandingFeature[]
  workflowSteps: { title: string; body: string; route: string }[]
  faqs: { question: string; answer: string }[]
  closing: { title: string; body: string }
}

export const landingContent: Record<LandingLocale, LandingContent> = {
  zh: {
    screenshotNote: '截图说明：合成会话、录制结果与本地演示，非在线执行或原生端验收证据；手机画面均为 H5 浏览器。',
    hero: {
      eyebrow: '源码可查 · 使用条款见 LICENSE · macOS · Windows · Linux',
      headline: ['把 EchoFlow Code 装进桌面，', '也装进'],
      accent: '口袋。',
      description: ['多会话并行、Agent Teams、Computer Use，模型随你接。', '手机扫码连上电脑，离开工位也能审批、派任务。'],
      desktopAlt: 'EchoFlow Code 桌面端：合成的欢迎会话，展示录制结果',
      phoneAlt: 'EchoFlow Code 中文 H5 浏览器：合成的待审批请求，尚未批准或执行',
      phoneLabel: '手机浏览器访问：'
    },
    downloads: {
      desktop: '下载桌面端',
      android: 'Android 分发状态',
      iphone: 'iPhone 分发状态',
      androidLabel: '查看 EchoFlow Android 分发状态',
      iphoneLabel: '查看 EchoFlow iPhone 分发状态',
      requirement: 'EchoFlow 手机安装包尚未核验；可先用手机浏览器连接。上游 v0.7.6 要求不代表 EchoFlow 版本承诺。'
    },
    mobile: {
      description: 'Android 和 iPhone 的浏览器扫码连上你的电脑。任务一直在电脑上跑，手机负责看进度、做决定。',
      abilities: [
        { title: '审批命令', body: 'Agent 想运行命令或改文件时，在手机上允许或拒绝。' },
        { title: '回答提问', body: 'Agent 需要你拿主意时，选一个答案它就接着做。' },
        { title: '派新任务', body: '想到什么发一句话，电脑上开一个新会话去做。' }
      ],
      connection: '同一 Wi-Fi 下直接连接，外出时走 Cloudflare。电脑需要开着，EchoFlow Code 保持运行。',
      docs: '了解手机连接',
      route: '/desktop/remote',
      screens: [
        { caption: 'H5 首页：演示会话列表', alt: '中文 H5 浏览器首页：echoflow-demo 项目的合成会话列表' },
        { caption: 'H5 审批：演示请求，尚未批准或执行', alt: '中文 H5 浏览器审批面板：合成的待审批请求，尚未批准或执行' },
        { caption: 'H5 回复：演示发布说明', alt: '中文 H5 浏览器会话页：合成的 v0.7.6 发布说明，显示已完成状态' }
      ]
    },
    taskSuggestions: [
      { label: '做一个新页面', prompt: '帮我把这个项目的首页做得更好看。先了解现有风格，再完成页面，检查手机端，并告诉我改了什么。', category: 'code' },
      { label: '让应用替我忙', prompt: '在「备忘录」里新建一条「本周计划」，写下阅读、散步和整理项目三个事项。只操作这一条笔记。', category: 'apps' },
      { label: '检查这次改动', prompt: '审阅当前项目的未提交改动，找出可能的功能问题，说明对应文件、原因和建议。先不要修改文件。', category: 'review' }
    ],
    features: [
      {
        id: 'teams',
        tab: 'Agent Teams',
        title: '一个目标，一支团队。',
        body: '把大目标交给队长：它拆分任务、指派成员，成员各自并行推进。依赖关系、进度和成员之间的消息都在同一个面板里，结束后还能回看。',
        route: '/internals/agent',
        alt: 'Agent Teams 演示提案：2 个拟议成员及任务处于 review_pending 待审阅状态，均未开始'
      },
      {
        id: 'computer-use',
        tab: 'Computer Use',
        title: '它有自己的光标。',
        body: 'macOS、Windows 和 Linux 都使用原生运行组件。macOS 14.4 及更新版本不移动真实鼠标；Windows 和 Linux 支持受控件与桌面环境限制的后台语义操作，物理输入可能占用真实鼠标或键盘。',
        route: '/desktop/computer-use',
        alt: 'Linux 上的 Computer Use 设置页：已禁用，运行组件不可用'
      },
      {
        id: 'models',
        tab: '多模型',
        title: '模型，随你选。',
        body: 'Claude、ChatGPT、Grok 官方账号直接登录，DeepSeek、Kimi、GLM 等常用 API 一键预设，本机的 Ollama、LM Studio 也能接。完整的 Agent 工作流需要模型支持工具调用。',
        route: '/start/models',
        alt: '输入框的模型菜单：无凭据的 EchoFlow 演示目录，展示 3 个模型'
      },
      {
        id: 'workbench',
        tab: '工作台',
        title: '多个任务，一个窗口。',
        body: '多个会话同时推进，内置浏览器直接预览页面，改动按文件逐个审阅、留下行级意见，都在一个桌面窗口里完成。',
        route: '/desktop/workspace',
        alt: '桌面工作台：合成会话与录制结果，内置浏览器展示静态双语本地演示页面'
      },
      {
        id: 'skills',
        tab: '技能市场',
        title: '技能市场，装上就能用。',
        body: '浏览 ClawHub 与 SkillHub 的精选技能，来源和安全扫描状态摆在明处，一键安装。技能来自社区第三方，安装前先看一眼技能文件。',
        route: '/desktop/skills',
        alt: '技能市场：内置目录的 398 个技能及其扫描状态徽标；徽标非独立安全审计结论'
      }
    ],
    workflowSteps: [
      { title: '住进你的电脑', body: '下载桌面应用，打开手边的项目。', route: '/start/install' },
      { title: '接上熟悉的模型', body: '官方账号、API 或本地模型，选择适合你的。', route: '/start/models' },
      { title: '交代一件小事', body: '说清目标与范围，选好这次任务的权限。', route: '/start/first-session' },
      { title: '看看它做得怎样', body: '检查结果，留下反馈，再决定下一步。', route: '/desktop/workspace' }
    ],
    faqs: [
      { question: 'EchoFlow Code 的使用条款是什么？', answer: '请阅读仓库 LICENSE 与 THIRD_PARTY_LICENSES.md。根许可证仅保留 EchoFlow Code 原创内容的全部权利；该原创内容的授权须另行取得由 LiuGuangHS / EchoFlow Code 签署的书面协议。它不授予第三方代码许可，也不是完整的最终用户许可协议。第三方代码保留各自适用的许可与声明。模型订阅和 API 费用由相应服务商收取。' },
      { question: '我的设备能用吗？', answer: '桌面应用提供 macOS、Windows 和 Linux 安装包，支持对应的 Intel / AMD 与 ARM 架构，按下载指南选择适合系统的版本即可。手机连接支持浏览器扫码接力；EchoFlow Android / iPhone 安装包分发状态以发布页及手机连接文档为准。Computer Use 的平台支持有所不同，见下方说明。' },
      { question: '手机怎么连上电脑？', answer: '在桌面端「手机连接」里开启浏览器连接并扫码配对：同一 Wi-Fi 下直接连接，外出时走 Cloudflare。EchoFlow 手机安装包尚未核验，上游 APK 和 TestFlight 群组不属于 EchoFlow 分发渠道。任务始终在电脑上运行。' },
      { question: '可以用我已经有的模型吗？', answer: '可以。支持通过 Claude、ChatGPT、Grok 官方账号登录，也可配置第三方 API 或连接本地模型。可用模型取决于账号权限和服务商；完整的 Agent 工作流还需要模型支持工具调用。' },
      { question: 'Computer Use 会抢我的鼠标吗？', answer: 'macOS 14.4 及更新版本的原生运行组件不移动真实鼠标；Windows 和 Linux 支持受控件与桌面环境限制的后台语义操作，物理输入可能占用真实鼠标或键盘。Linux 需要可用的图形会话与 AT-SPI 服务；后台操作仍可能改变应用焦点或内容，不会创建独立虚拟桌面。启用前需要完成应用内确认及相应系统授权。' },
      { question: '我能控制 AI 改哪些东西吗？', answer: '可以选择权限模式。默认「询问权限」会在需要授权的写文件、执行命令操作前请求确认，也可以切换到仅规划等模式。编辑后可在工作区审阅差异、留下反馈。Computer Use 单独启用并确认后可操作所有受支持应用，因此也要在任务中写清范围。' }
    ],
    closing: {
      title: '下一件想做的事，交给它试试。',
      body: '从一个小任务开始，让今天多一点自己的时间。'
    }
  },
  en: {
    screenshotNote: 'Screenshots use synthetic conversations, recorded results, and local demos, not evidence of live execution or native app acceptance testing. All phone views are H5 browser screens.',
    hero: {
      eyebrow: 'Source available · See LICENSE · macOS · Windows · Linux',
      headline: ['EchoFlow Code on your desktop.', 'And in your '],
      accent: 'pocket.',
      description: ['Parallel sessions, Agent Teams, Computer Use, and any model you like.', 'Pair your phone to approve and start tasks away from your desk.'],
      desktopAlt: 'EchoFlow Code desktop (Chinese interface): a synthetic welcome conversation with recorded results',
      phoneAlt: 'EchoFlow Code H5 browser (Chinese interface): a synthetic pending request, not approved or executed',
      phoneLabel: 'Phone browser access:'
    },
    downloads: {
      desktop: 'Get the desktop app',
      android: 'Android availability',
      iphone: 'iPhone availability',
      androidLabel: 'Check EchoFlow Android distribution status',
      iphoneLabel: 'Check EchoFlow iPhone distribution status',
      requirement: 'EchoFlow mobile packages are not verified; use the phone browser meanwhile. The upstream v0.7.6 requirement is not an EchoFlow version promise.'
    },
    mobile: {
      description: 'Pair an Android or iPhone browser with your computer by QR code. Tasks keep running on the computer while your phone follows along and makes the calls.',
      abilities: [
        { title: 'Approve commands', body: 'When the agent wants to run a command or edit files, allow or deny it from your phone.' },
        { title: 'Answer questions', body: 'When the agent needs a decision, pick an answer and it carries on.' },
        { title: 'Start new tasks', body: 'Send one sentence and a new session starts on your computer.' }
      ],
      connection: 'Connect directly on the same Wi-Fi, or through Cloudflare when you are away. Your computer stays on with EchoFlow Code running.',
      docs: 'How phone pairing works',
      route: '/en/desktop/remote',
      screens: [
        { caption: 'H5 home: demo sessions', alt: 'H5 browser home (Chinese interface): synthetic sessions in the echoflow-demo project' },
        { caption: 'H5 approval: demo request, not approved or executed', alt: 'H5 browser approval panel (Chinese interface): a synthetic pending request, not approved or executed' },
        { caption: 'H5 reply: demo release notes', alt: 'H5 browser conversation (Chinese interface): synthetic v0.7.6 release notes with completed status' }
      ]
    },
    taskSuggestions: [
      { label: 'Build a new page', prompt: 'Give this project a better homepage. Get to know its existing style, build the page, check it on mobile, and show me what changed.', category: 'code' },
      { label: 'Work across apps', prompt: 'In Notes, create a note called “This week” with three items: read, go for a walk, and tidy up my project. Only change this new note.', category: 'apps' },
      { label: 'Review my changes', prompt: 'Review the uncommitted changes in this project for functional issues. Include the file, reasoning, and a suggested fix for each finding. Do not edit files yet.', category: 'review' }
    ],
    features: [
      {
        id: 'teams',
        tab: 'Agent Teams',
        title: 'One goal, one team.',
        body: 'Hand a large goal to a team lead. It splits the work and assigns teammates who run in parallel, with dependencies, progress, and every message between them on one board you can replay afterwards.',
        route: '/en/internals/agent',
        alt: 'Agent Teams demo proposal (Chinese interface): 2 proposed members and tasks in review_pending, none started'
      },
      {
        id: 'computer-use',
        tab: 'Computer Use',
        title: 'It has its own cursor.',
        body: 'macOS, Windows, and Linux use native runtimes. On macOS 14.4 and later, operations do not move your physical mouse. Windows and Linux support background semantic operations where the control and desktop environment allow them; physical input may use your mouse or keyboard.',
        route: '/en/desktop/computer-use',
        alt: 'Computer Use settings on Linux (Chinese interface): disabled, runtime unavailable'
      },
      {
        id: 'models',
        tab: 'Models',
        title: 'Any model you want.',
        body: 'Sign in with an official Claude, ChatGPT, or Grok account, pick a preset for DeepSeek, Kimi, GLM, and other APIs, or connect Ollama and LM Studio on your own machine. Full agent workflows need a model that supports tool calling.',
        route: '/en/start/models',
        alt: 'Composer model menu (Chinese interface): EchoFlow demo catalog with 3 models, configured without credentials'
      },
      {
        id: 'workbench',
        tab: 'Workbench',
        title: 'Many tasks, one window.',
        body: 'Run several sessions at once, preview pages in the built-in browser, and review changes file by file with line comments, all in one desktop app.',
        route: '/en/desktop/workspace',
        alt: 'Desktop workbench (Chinese interface): a synthetic conversation with recorded results and a static bilingual local demo in the built-in browser'
      },
      {
        id: 'skills',
        tab: 'Skills',
        title: 'Install a skill, use it now.',
        body: 'Browse curated skills from ClawHub and SkillHub with their source and security scan status in plain view, then install in one click. Skills come from community sources, so look over the files before installing.',
        route: '/en/desktop/skills',
        alt: 'Skills Market (Chinese interface): 398 skills in the bundled catalog with scan-status badges, not an independent security audit'
      }
    ],
    workflowSteps: [
      { title: 'Make room on your desktop', body: 'Download the app and open a project.', route: '/en/start/install' },
      { title: 'Bring a model you know', body: 'Choose an official account, an API, or a local model.', route: '/en/start/models' },
      { title: 'Hand over one small task', body: 'Set the goal, scope, and permission mode.', route: '/en/start/first-session' },
      { title: 'See how it turned out', body: 'Review the result, leave feedback, and choose what comes next.', route: '/en/desktop/workspace' }
    ],
    faqs: [
      { question: 'What are the EchoFlow Code use terms?', answer: 'Read LICENSE and THIRD_PARTY_LICENSES.md in the repository. The root license reserves all rights in original EchoFlow Code work only. Permission for that work requires a separate written agreement signed by LiuGuangHS / EchoFlow Code. It does not license third-party code and is not a full end-user license agreement. Third-party code retains its applicable licenses and notices. Model subscriptions and API usage are billed separately by your provider.' },
      { question: 'Will it work on my devices?', answer: 'Desktop packages are available for macOS, Windows, and Linux, with supported Intel / AMD and ARM builds. Choose the right package in the installation guide. Phone access supports browser pairing; check the release page and phone connection guide for EchoFlow Android / iPhone package availability. Computer Use has separate platform requirements, described below.' },
      { question: 'How do I connect my phone?', answer: 'Enable browser access under Phone connection in the desktop app and scan its QR code. Connect directly on the same Wi-Fi, or through Cloudflare when away. EchoFlow mobile packages are not verified; upstream APKs and TestFlight groups are not EchoFlow distribution channels. Tasks always run on your computer.' },
      { question: 'Can I use a model I already have?', answer: 'Yes. Sign in with an official Claude, ChatGPT, or Grok account, configure a third-party API, or connect a local model. Available models depend on your account and provider. Agent workflows also require a model that supports tool calling.' },
      { question: 'Will Computer Use take over my mouse?', answer: 'On macOS 14.4 and later, native operations do not move your physical mouse. Windows and Linux support background semantic operations where the control and desktop environment allow them; physical input may use your mouse or keyboard. Linux needs an available graphical session and AT-SPI services. Background operations can still change app focus or content and do not create a separate virtual desktop. Enabling the feature requires in-app consent and the relevant system permissions.' },
      { question: 'Can I control what AI changes?', answer: 'Choose a permission mode. The default Ask mode requests approval for file writes and commands that require authorization; other modes include planning only. Review edits and leave feedback in the workspace. Computer Use is enabled separately: once confirmed, it can operate all supported apps, so define the scope in your task as well.' }
    ],
    closing: {
      title: 'What would you like to do next?',
      body: 'Start with one small task. Make a little more room for yourself today.'
    }
  }
}
