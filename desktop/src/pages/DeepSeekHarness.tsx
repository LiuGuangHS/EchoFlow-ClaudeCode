import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { getDesktopHost } from '../lib/desktopHost'
import type { DeepSeekHarnessStatus } from '../lib/desktopHost/types'

const desktopHost = getDesktopHost()

const initialStatus: DeepSeekHarnessStatus = {
  state: 'not-installed',
  version: null,
  url: null,
  error: null,
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

  const installed = status.version !== null
  const running = status.state === 'running'
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
              {running ? '正在运行' : unavailable ? '运行环境不可用' : installed ? '已停止' : '未安装'}
            </span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            在 EchoFlow 中安装、启动和打开原版 DeepSeek Harness。DeepSeek Harness 的会话和插件能力保持独立，不接入 EchoFlow 的 Agent Loop。
          </p>
        </header>

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-5">
          <div className="flex flex-wrap items-center gap-3">
            {!installed && !unavailable && (
              <Button loading={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.install())}>
                安装 DeepSeek Harness
              </Button>
            )}
            {installed && !running && (
              <Button loading={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.start())}>
                启动
              </Button>
            )}
            {installed && !running && (
              <Button variant="secondary" loading={loading} onClick={() => void run(() => desktopHost.deepSeekHarness.install())}>
                更新 / 重新安装
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

          {installed && (
            <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
              当前版本：{status.version}
            </p>
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
