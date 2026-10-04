import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { getDesktopHost } from '../lib/desktopHost'
import type { DeepSeekHarnessStatus } from '../lib/desktopHost/types'

const desktopHost = getDesktopHost()

const initialStatus: DeepSeekHarnessStatus = {
  state: 'unavailable',
  version: null,
  url: null,
  error: null,
  nodeVersion: null,
  nodeSource: null,
}

export function DeepSeekHarness() {
  const [status, setStatus] = useState(initialStatus)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setStatus(await desktopHost.deepSeekHarness.getStatus())
  }, [])

  useEffect(() => {
    void refresh().catch(error => {
      setStatus(current => ({
        ...current,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      }))
    })
  }, [refresh])

  const run = useCallback(async (action: () => Promise<DeepSeekHarnessStatus | void>) => {
    setLoading(true)
    try {
      const next = await action()
      if (next) setStatus(next)
      else await refresh()
    } catch (error) {
      setStatus(current => ({
        ...current,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const running = status.state === 'running'
  const installing = status.state === 'installing' || status.state === 'starting'
  const unavailable = status.state === 'unavailable'

  return (
    <main className="flex min-h-0 flex-1 overflow-auto bg-[var(--color-surface)]">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-10">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">DeepSeek Harness</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${running
              ? 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]'
              : 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'}`}
            >
              {running ? '正在运行' : installing ? '正在准备并启动' : unavailable ? '缺少兼容的 Node.js' : status.state === 'error' ? '启动失败' : '已停止'}
            </span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            使用官方 npm 包启动原版 DeepSeek Harness。首次启动会按需下载；EchoFlow 提供隔离的 Node.js 运行环境与数据目录，Harness 的会话和插件能力保持独立。
          </p>
        </header>

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-5">
          <div className="flex flex-wrap items-center gap-3">
            {!running && !installing && (
              <Button loading={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.start())}>
                {unavailable ? '准备运行环境并启动' : '启动'}
              </Button>
            )}
            {running && (
              <Button loading={loading} onClick={() => void run(async () => {
                await desktopHost.deepSeekHarness.open()
              })}>
                打开 DeepSeek Harness
              </Button>
            )}
            {running && (
              <Button variant="secondary" disabled={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.restart())}>
                重启
              </Button>
            )}
            {running && (
              <Button variant="secondary" disabled={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.stop())}>
                停止
              </Button>
            )}
          </div>

          <dl className="mt-4 grid gap-1 text-sm text-[var(--color-text-secondary)] sm:grid-cols-2">
            <div>DeepSeek Harness：{status.version ?? '由 npm 按需解析'}</div>
            <div>Node.js：{status.nodeVersion ?? (unavailable ? '未就绪' : '检测中')}{status.nodeSource === 'managed' ? '（EchoFlow 管理）' : status.nodeSource === 'system' ? '（系统）' : ''}</div>
          </dl>
          {((running) || status.state === 'stopped') && (
            <Button className="mt-4" variant="secondary" loading={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.update())}>
              {running ? '检查官方更新并重启' : '检查官方更新并启动'}
            </Button>
          )}
          {status.error && (
            <p role="alert" className="mt-4 text-sm text-[var(--color-error)]">
              {status.error}
            </p>
          )}
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-5 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">
          DeepSeek Harness 的配置、会话和插件数据保存在独立目录，不会与 EchoFlow 的服务商、会话、Skills、MCP 或 Agents 自动同步。本阶段不提供插件市场，后续插件管理能力将单独设计。
        </div>
      </section>
    </main>
  )
}
