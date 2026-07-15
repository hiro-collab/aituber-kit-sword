import { create } from 'zustand'

import type { SpeechOutputSummary } from '@/utils/speechOutputParitySummary'

type ProjectionDisplayState = {
  assistantMessage: string
  assistantMessageId: string | null
  speechOutputSummary: SpeechOutputSummary | null
  speechOutputActive: boolean
  sequence: number
  updatedAt: string | null
}

type ProjectionDisplayStore = ProjectionDisplayState & {
  setDisplayState: (state: ProjectionDisplayState) => void
}

const projectionDisplayStore = create<ProjectionDisplayStore>()((set) => ({
  assistantMessage: '',
  assistantMessageId: null,
  speechOutputSummary: null,
  speechOutputActive: false,
  sequence: 0,
  updatedAt: null,
  setDisplayState: (state) => set(state),
}))

export default projectionDisplayStore
