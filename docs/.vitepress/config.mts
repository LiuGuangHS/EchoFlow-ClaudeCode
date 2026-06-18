import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const siteUrl = 'https://code.echoflow.cn'
const apiSiteUrl = 'https://api.echoflow.cn'
const aiAppUrl = 'https://ai.echoflow.cn'
const siteImage = `${siteUrl}/images/app-icon.png`
const docsBase = normalizeBase(process.env.DOCS_BASE)
const zhDescription = 'EchoFlow Code 是本地可运行的 Coding Agent，内置 EchoFlowAPI，支持 Anthropic 兼容 API、多 Agent、记忆系统、桌面端、IM 接入与 Computer Use。'
const enDescription = 'EchoFlow Code is a locally runnable coding agent with EchoFlowAPI, Anthropic-compatible API support, multi-agent workflows, memory, desktop, IM adapters, and Computer Use.'
const organizationJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: '清云 API',
  alternateName: 'EchoFlowAPI',
  url: apiSiteUrl,
  sameAs: [
    siteUrl,
    aiAppUrl,
    'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode',
  ],
})
const softwareJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'EchoFlow Code',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Windows, macOS, Linux',
  url: siteUrl,
  image: siteImage,
  description: zhDescription,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  publisher: {
    '@type': 'Organization',
    name: '清云 API',
    url: apiSiteUrl,
  },
  sameAs: [
    apiSiteUrl,
    aiAppUrl,
    'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode',
  ],
})

// GitHub-compatible slugify (matches github-slugger algorithm)
// Makes heading anchor IDs consistent between VitePress and GitHub rendering
function slugify(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

function normalizeBase(base = '/'): string {
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function canonicalUrl(page: string): string {
  const normalized = page.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
  const path = normalized === '/' ? '/' : `/${normalized.replace(/^\/+/, '')}`
  return new URL(path, siteUrl).toString()
}

function alternateUrl(page: string, targetLocale: 'zh' | 'en'): string {
  const withoutEn = page.replace(/^en\//, '')
  const localized = targetLocale === 'en' ? `en/${withoutEn}` : withoutEn
  return canonicalUrl(localized)
}

const zhSidebar = [
  {
    text: '快速开始',
    items: [
      { text: '安装与启动', link: '/guide/quick-start' },
      { text: '环境变量', link: '/guide/env-vars' },
      { text: '第三方模型', link: '/guide/third-party-models' },
      { text: '全局使用', link: '/guide/global-usage' },
      { text: '常见问题', link: '/guide/faq' },
      { text: '贡献与质量门禁', link: '/guide/contributing' },
    ],
  },
  {
    text: '记忆系统',
    collapsed: false,
    items: [
      { text: '概览', link: '/memory/' },
      { text: '使用指南', link: '/memory/01-usage-guide' },
      { text: '实现原理', link: '/memory/02-implementation' },
      { text: 'AutoDream 记忆整合', link: '/memory/03-autodream' },
    ],
  },
  {
    text: '多 Agent 系统',
    collapsed: false,
    items: [
      { text: '概览', link: '/agent/' },
      { text: '使用指南', link: '/agent/01-usage-guide' },
      { text: '实现原理', link: '/agent/02-implementation' },
      { text: 'Agent 框架解析', link: '/agent/03-agent-framework' },
    ],
  },
  {
    text: 'Skills 系统',
    collapsed: false,
    items: [
      { text: '使用指南', link: '/skills/01-usage-guide' },
      { text: '实现原理', link: '/skills/02-implementation' },
    ],
  },
  {
    text: 'IM 接入',
    collapsed: false,
    items: [
      { text: '总览', link: '/im/' },
      { text: '微信', link: '/im/wechat' },
      { text: '钉钉', link: '/im/dingtalk' },
      { text: 'Telegram', link: '/im/telegram' },
      { text: '飞书', link: '/im/feishu' },
    ],
  },
  {
    text: 'Channel 源码研究',
    collapsed: false,
    items: [
      { text: '概览', link: '/channel/' },
      { text: '架构解析', link: '/channel/01-channel-system' },
    ],
  },
  {
    text: 'Computer Use',
    collapsed: false,
    items: [
      { text: '功能指南', link: '/features/computer-use' },
      { text: '架构解析', link: '/features/computer-use-architecture' },
    ],
  },
  {
    text: '桌面端',
    collapsed: false,
    items: [
      { text: '概览', link: '/desktop/' },
      { text: '快速上手', link: '/desktop/01-quick-start' },
      { text: '架构设计', link: '/desktop/02-architecture' },
      { text: '功能详解', link: '/desktop/03-features' },
      { text: '安装与构建', link: '/desktop/04-installation' },
      { text: 'H5 访问', link: '/desktop/06-h5-access' },
      { text: 'Electron 迁移调研', link: '/desktop/07-electron-migration-research' },
      { text: 'Electron 迁移任务', link: '/desktop/08-electron-migration-tasks' },
      { text: 'Electron 迁移验证', link: '/desktop/09-electron-migration-validation-checklist' },
      { text: 'Electron 发布与更新', link: '/desktop/10-release-auto-update' },
    ],
  },
  {
    text: '移动端',
    collapsed: false,
    items: [
      { text: 'Android 客户端', link: '/mobile/' },
    ],
  },
  {
    text: '参考',
    collapsed: true,
    items: [
      { text: '源码修复记录', link: '/reference/fixes' },
      { text: '项目结构', link: '/reference/project-structure' },
    ],
  },
]

const enSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Quick Start', link: '/en/guide/quick-start' },
      { text: 'Environment Variables', link: '/en/guide/env-vars' },
      { text: 'Third-Party Models', link: '/en/guide/third-party-models' },
      { text: 'Global Usage', link: '/en/guide/global-usage' },
      { text: 'FAQ', link: '/en/guide/faq' },
      { text: 'Contributing', link: '/en/guide/contributing' },
    ],
  },
  {
    text: 'Memory System',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/memory/' },
      { text: 'Usage Guide', link: '/en/memory/01-usage-guide' },
      { text: 'Implementation', link: '/en/memory/02-implementation' },
      { text: 'AutoDream', link: '/en/memory/03-autodream' },
    ],
  },
  {
    text: 'Multi-Agent System',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/agent/' },
      { text: 'Usage Guide', link: '/en/agent/01-usage-guide' },
      { text: 'Implementation', link: '/en/agent/02-implementation' },
      { text: 'Framework Deep Dive', link: '/en/agent/03-agent-framework' },
    ],
  },
  {
    text: 'Skills System',
    collapsed: false,
    items: [
      { text: 'Usage Guide', link: '/en/skills/01-usage-guide' },
      { text: 'Implementation', link: '/en/skills/02-implementation' },
    ],
  },
  {
    text: 'Channel System',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/channel/' },
      { text: 'Architecture', link: '/en/channel/01-channel-system' },
    ],
  },
  {
    text: 'Computer Use',
    collapsed: false,
    items: [
      { text: 'Guide', link: '/en/features/computer-use' },
      { text: 'Architecture', link: '/en/features/computer-use-architecture' },
    ],
  },
  {
    text: 'Desktop (Chinese docs)',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/desktop/' },
      { text: 'Quick Start', link: '/desktop/01-quick-start' },
      { text: 'Architecture', link: '/desktop/02-architecture' },
      { text: 'Features', link: '/desktop/03-features' },
      { text: 'Installation & Build', link: '/desktop/04-installation' },
    ],
  },
  {
    text: 'Mobile',
    collapsed: false,
    items: [
      { text: 'Android Client', link: '/en/mobile/' },
    ],
  },
  {
    text: 'Reference',
    collapsed: true,
    items: [
      { text: 'Source Fixes', link: '/en/reference/fixes' },
      { text: 'Project Structure', link: '/en/reference/project-structure' },
    ],
  },
]

export default withMermaid(defineConfig({
  title: 'EchoFlow Code',
  description: zhDescription,
  lastUpdated: true,
  base: docsBase,
  cleanUrls: true,
  sitemap: {
    hostname: siteUrl,
  },

  markdown: {
    anchor: {
      slugify,
    },
  },

  vite: {
    build: {
      chunkSizeWarningLimit: 1800,
    },
  },

  head: [
    ['meta', { name: 'theme-color', content: '#D97757' }],
    ['meta', { property: 'og:site_name', content: 'EchoFlow Code' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:image', content: siteImage }],
    ['meta', { property: 'og:image:alt', content: 'EchoFlow Code' }],
    ['meta', { name: 'keywords', content: 'EchoFlow Code, 清云 API, EchoFlowAPI, api.echoflow.cn, ai.echoflow.cn, AI 编程工具, Coding Agent, Claude Code, AI 应用, 多 Agent, Computer Use' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: siteImage }],
    ['link', { rel: 'dns-prefetch', href: apiSiteUrl }],
    ['link', { rel: 'dns-prefetch', href: aiAppUrl }],
    ['script', { type: 'application/ld+json' }, organizationJsonLd],
    ['script', { type: 'application/ld+json' }, softwareJsonLd],
    ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-D42DM82263' }],
    ['script', {}, `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-D42DM82263');`],
  ],

  transformHead({ page, title, description }) {
    const url = canonicalUrl(page)
    const isEnglish = page.startsWith('en/')
    const locale = isEnglish ? 'en_US' : 'zh_CN'

    return [
      ['link', { rel: 'canonical', href: url }],
      ['link', { rel: 'alternate', hreflang: 'zh-CN', href: alternateUrl(page, 'zh') }],
      ['link', { rel: 'alternate', hreflang: 'en-US', href: alternateUrl(page, 'en') }],
      ['link', { rel: 'alternate', hreflang: 'x-default', href: alternateUrl(page, 'zh') }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:locale', content: locale }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ]
  },

  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '清云 API 主站', link: apiSiteUrl },
          { text: '清云 AI 在线应用站', link: aiAppUrl },
        ],
        sidebar: zhSidebar,
        outline: { label: '页面导航' },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
        lastUpdated: { text: '最后更新于' },
        docFooter: { prev: '上一页', next: '下一页' },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: enDescription,
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Quick Start', link: '/en/guide/quick-start' },
          { text: 'Qingyun API', link: apiSiteUrl },
          { text: 'Qingyun AI Apps', link: aiAppUrl },
        ],
        sidebar: enSidebar,
      },
    },
  },

  themeConfig: {
    editLink: {
      pattern: 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 EchoFlow Code Contributors',
    },
  },
}))
