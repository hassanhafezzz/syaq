export type Segment = { name: string; tokens: number; color: string; kind: 'used' | 'free' }

export type View = 'full' | 'slim'

// The percent is rounded as shown, so its colour matches the figure
export type Limit = { kind: string; percent: number }

export type Snapshot = {
  total: number
  max: number
  percent: number
  threshold: number | null
  segments: Segment[]
  model: string
  limits: Limit[]
  // Absent where the host keeps no ledger
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    // The snapshot is kept under a shape tag (claude-code's Shaped, spelled out
    // because the contract can't import it)
    'syaq': { snapshot: { shape: string; value: Snapshot | null }; view: View }
  }
}
