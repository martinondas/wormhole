import {
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Group,
  Color,
  FrontSide,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { TREASURE } from '../config'
import { type WallObject } from './wallObject'

// A gold brilliant-cut gem: a flat table on top, a faceted crown widening to the
// waist, then a long pavilion tapering to a point - the universal "treasure"
// silhouette. Built as an edge-lit SOLID (near-black warm fill under bright gold
// fat-line edges) like the ship, but NORMAL-blended like the orb so the gold
// edges stay gold rather than blooming to white. Spins briskly so facets flash.
function buildGem(): BufferGeometry {
  const R = TREASURE.RADIUS
  const F = TREASURE.FACETS // low radial count -> crisp vertical facet ridges
  const tableR = R * TREASURE.TABLE_RATIO
  const crownH = R * TREASURE.CROWN_RATIO
  const pavH = R * TREASURE.PAVILION_RATIO

  const parts: BufferGeometry[] = []

  // crown: table (top) tapering out to the waist (radius R) at y = 0. Capped so
  // the table reads as a solid facet, not a hole.
  const crown = new CylinderGeometry(tableR, R, crownH, F, 1)
  crown.translate(0, crownH / 2, 0)
  parts.push(crown)

  // pavilion: long cone, base at the waist (radius R, y = 0), point facing down.
  const pav = new ConeGeometry(R, pavH, F)
  pav.rotateX(Math.PI) // apex faces -Y
  pav.translate(0, -pavH / 2, 0)
  parts.push(pav)

  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('treasure: failed to merge gem geometry')
  parts.forEach((p) => p.dispose())
  merged.center() // bbox centered on origin so it rides centered on the wall
  return merged
}

export function createTreasure(): WallObject {
  const inner = new Group()
  const geom = buildGem()

  // dark, gold-tinted depth-writing fill: occludes the back facets + the tube
  // behind so the gem reads as a solid jewel, not a wire cage.
  const fillMat = new MeshBasicMaterial({
    color: new Color().setRGB(...TREASURE.FILL_RGB),
    side: FrontSide,
    transparent: true,
    opacity: TREASURE.FILL_OPACITY,
  })
  inner.add(new Mesh(geom, fillMat))

  // bright gold facet edges. Normal blend (depthTest) so the edges stay gold
  // over the fill; additive HDR gold would sum toward white and lose the hue.
  const edgesGeo = new EdgesGeometry(geom, TREASURE.EDGE_THRESHOLD)
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo)
  const lineMat = new LineMaterial({
    color: new Color().setRGB(...TREASURE.EDGE_RGB).getHex(),
    linewidth: TREASURE.LINE_WIDTH,
    worldUnits: false,
    transparent: true,
    depthTest: true,
    fog: true, // fade in through the tube fog as it approaches
  })
  lineMat.color.setRGB(...TREASURE.EDGE_RGB) // preserve HDR (>1) values for bloom
  const edges = new LineSegments2(lineGeo, lineMat)
  edges.computeLineDistances()
  inner.add(edges)
  edgesGeo.dispose()

  const object = new Group()
  object.add(inner)

  let t = 0
  return {
    object,
    update(dt: number): void {
      t += dt
      inner.rotation.y += TREASURE.SPIN_SPEED * dt // brisk jewel spin
      inner.position.y = Math.sin(t * TREASURE.BOB_SPEED) * TREASURE.BOB_AMP
    },
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
    setOpacity(o: number): void {
      fillMat.opacity = TREASURE.FILL_OPACITY * o
      lineMat.opacity = o
    },
  }
}
