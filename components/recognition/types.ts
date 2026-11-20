export type EngineFacing = 'front' | 'back';

export interface EngineResult {
  hasHand: boolean;
  n?: number;
  label?: string;
  conf?: number;
}

export type EngineStatus =
  | { state: 'loading'; message?: string }
  | { state: 'ready' }
  | { state: 'error'; code?: string; message?: string };

export interface EngineProps {
  active: boolean;
  facing: EngineFacing;
  onResult: (r: EngineResult) => void;
  onStatus: (s: EngineStatus) => void;
  onFps?: (fps: number) => void;
  /** Camera frame size, so the host can match the preview's aspect ratio. */
  onDims?: (w: number, h: number) => void;
}
