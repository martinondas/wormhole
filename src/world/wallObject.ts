import { type Group } from 'three'

// The contract every "wall object" implements (energy orb, treasure gem, hazard
// mine). A generic field (see field.ts) owns a pool of these: it positions the
// outer `object` group on the tube wall and drives the collect/explode fade via
// scale + setOpacity. Each object animates its own inner group (spin/bob/pulse)
// in update(dt).
export interface WallObject {
  object: Group
  update(dt: number): void
  setResolution(w: number, h: number): void
  setOpacity(o: number): void // 1 = normal; used for the collect/explode fade
}
