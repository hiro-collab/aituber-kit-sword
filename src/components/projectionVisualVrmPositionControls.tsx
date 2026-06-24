import {
  ArrowPathIcon,
  LockClosedIcon,
  LockOpenIcon,
} from '@heroicons/react/24/outline'

import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import toastStore from '@/features/stores/toast'

type PositionAction = 'fix' | 'unfix' | 'reset'

const actionLabels: Record<PositionAction, string> = {
  fix: '現在のVRM表示位置を固定',
  unfix: 'VRM表示位置の固定を解除',
  reset: 'VRM表示位置を自動位置へリセット',
}

const runPositionAction = (action: PositionAction) => {
  const { viewer } = homeStore.getState()

  if (action === 'fix') {
    viewer.fixCameraPosition()
  } else if (action === 'unfix') {
    viewer.unfixCameraPosition()
  } else {
    viewer.resetCameraPosition()
  }

  const toastMessage =
    action === 'fix'
      ? 'VRM表示位置を固定しました'
      : action === 'unfix'
        ? 'VRM表示位置の固定を解除しました'
        : 'VRM表示位置をリセットしました'

  toastStore.getState().addToast({
    message: toastMessage,
    type: action === 'fix' ? 'success' : 'info',
    tag: `projection-visual-vrm-position-${action}`,
  })
}

const iconButtonClass =
  'grid h-9 w-9 place-items-center rounded-md border border-cyan-200/35 bg-cyan-50/10 text-cyan-50 shadow-sm transition hover:border-cyan-100 hover:bg-cyan-50/20 active:bg-cyan-50/30'

export function ProjectionVisualVrmPositionControls() {
  const fixedCharacterPosition = settingsStore((s) => s.fixedCharacterPosition)

  const primaryAction: PositionAction = fixedCharacterPosition ? 'unfix' : 'fix'
  const PrimaryIcon = fixedCharacterPosition ? LockOpenIcon : LockClosedIcon

  return (
    <div
      className="projection-visual-vrm-position-controls z-[26] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border border-cyan-100/30 bg-slate-950/75 px-2 py-2 text-xs font-bold text-cyan-50 shadow-lg backdrop-blur"
      data-projection-visual-vrm-position-controls="true"
      data-vrm-position-fixed={String(fixedCharacterPosition)}
      aria-label="VRM display position controls"
    >
      <span className="whitespace-nowrap px-1">
        VRM {fixedCharacterPosition ? '固定中' : '調整可'}
      </span>
      <button
        type="button"
        className={iconButtonClass}
        onClick={() => runPositionAction(primaryAction)}
        title={actionLabels[primaryAction]}
        aria-label={actionLabels[primaryAction]}
        aria-pressed={fixedCharacterPosition}
      >
        <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        onClick={() => runPositionAction('reset')}
        title={actionLabels.reset}
        aria-label={actionLabels.reset}
      >
        <ArrowPathIcon className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}
