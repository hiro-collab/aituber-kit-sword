import { BrowserControlOwner } from '@/features/browserControl/useBrowserControlOwner'

type Props = {
  owner: BrowserControlOwner | null
  onTakeControl: () => void
  compact?: boolean
}

export const BrowserControlNotice = ({
  owner,
  onTakeControl,
  compact = false,
}: Props) => {
  const ownerLabel = owner?.label ?? 'another tab'

  return (
    <div
      className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 border border-cyan-400/50 bg-black/85 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.24)] backdrop-blur-sm ${
        compact ? 'max-w-[520px]' : 'max-w-[680px]'
      } w-[calc(100vw-32px)] px-4 py-3 font-mono`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">
            Passive Browser
          </div>
          <div className="truncate text-sm font-bold">
            Control owner: {ownerLabel}
          </div>
          {!compact && (
            <div className="mt-1 text-xs text-cyan-100/75">
              STT, gesture input, AI requests, and external message intake are
              paused in this tab.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onTakeControl}
          className="min-h-9 border border-cyan-400/60 bg-cyan-950/80 px-3 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100 hover:bg-cyan-800/80"
        >
          Take Control
        </button>
      </div>
    </div>
  )
}
