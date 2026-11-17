import { BLAST, HAZARD, RIDE_RADIUS } from '../config'
import { angleDiff } from '../util/math'
import { farScale } from './farScale'

// The rules of a mine blast (config BLAST) as pure functions, shared by the game
// (session.ts, field.ts) and by the playtest bots, which feed them the positions
// they judge. No state and no allocation: the caller owns every array.

// Distance between two points on the unrolled tube wall, where every wall object,
// raider and the ship ride: the arc between the two angles at RIDE_RADIUS, and `dz`
// along the tube.
export const wallDistance = (thetaA: number, thetaB: number, dz: number): number =>
  Math.hypot(angleDiff(thetaA, thetaB) * RIDE_RADIUS, dz)

// True when a point is inside the blast of a mine: `dz` along the tube apart.
export const inBlast = (thetaA: number, thetaB: number, dz: number): boolean => wallDistance(thetaA, thetaB, dz) < BLAST.RADIUS

// The same blast as an angle: the half angle (rad) it spans at RIDE_RADIUS, `dz`
// along the tube from the mine. 0 where it does not reach.
export const blastHalfAngle = (dz: number): number => Math.sqrt(Math.max(0, BLAST.RADIUS ** 2 - dz ** 2)) / RIDE_RADIUS

// True when a player bolt touches a mine: `dz` along the tube apart, the mine at
// ship-relative `mineZ` (the angular window follows the drawn size, see HAZARD.SHOT_ANGLE).
export const boltHitsMine = (boltTheta: number, mineTheta: number, dz: number, mineZ: number): boolean =>
  Math.abs(dz) < HAZARD.SHOT_Z && Math.abs(angleDiff(boltTheta, mineTheta)) < HAZARD.SHOT_ANGLE * farScale(mineZ)

// The chain a shot mine sets off, all in the instant of the shot: every mine inside
// the blast of a detonating mine detonates too. Among `n` mines at (theta[i], wd[i])
// with mine `first` struck, fills link[i] with the chain link each mine goes off at
// (0 = the struck mine, 1 = reached by its blast, ...; -1 = not reached) and order[]
// with the mines that go off, nearest link first. Returns how many go off.
export function chainLinks(theta: Float64Array, wd: Float64Array, n: number, first: number, link: Int8Array, order: Uint8Array): number {
  for (let i = 0; i < n; i++) link[i] = -1
  link[first] = 0
  order[0] = first
  let count = 1
  for (let head = 0; head < count; head++) {
    const i = order[head]!
    for (let j = 0; j < n; j++) {
      if (link[j] !== -1 || !inBlast(theta[i]!, theta[j]!, wd[i]! - wd[j]!)) continue
      link[j] = link[i]! + 1
      order[count++] = j
    }
  }
  return count
}
