import { EdgesGeometry, type BufferGeometry, Mesh, MeshBasicMaterial, Group, Color, FrontSide } from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

// Shared construction for the edge-lit SOLID look: a near-black depth-writing fill
// under glowing fat-line edges (EdgesGeometry), NORMAL blend so the HDR edge color
// keeps its hue and still blooms. Used by the gem, mine, extra-life cross, and
// raider - every wall object / enemy that reads as a solid body rather than a wire
// cage. (The orb is a glow balloon and the ship uses additive blend, so each builds
// its own variant.) Edges are not dashed, so computeLineDistances() is unnecessary.
export interface EdgeLitSolid {
  inner: Group // holds the fill + edge meshes; the owner spins / bobs / scales it
  fillMat: MeshBasicMaterial
  lineMat: LineMaterial // exposed so an owner can retint (e.g. the raider charge tell)
  setOpacity(o: number): void // 1 = at rest; drives the collect / death fade
  setResolution(w: number, h: number): void
}

export function createEdgeLitSolid(
  geometry: BufferGeometry,
  edgeRGB: readonly [number, number, number],
  fillRGB: readonly [number, number, number],
  lineWidth: number,
  edgeThreshold: number,
  fillOpacity = 1,
): EdgeLitSolid {
  // dark, depth-writing fill so the body reads as solid (occludes back edges + the
  // tube behind). transparent so setOpacity can fade it for the collect / death pop.
  const fillMat = new MeshBasicMaterial({
    color: new Color().setRGB(...fillRGB),
    side: FrontSide,
    transparent: true,
    opacity: fillOpacity,
  })
  const fill = new Mesh(geometry, fillMat)

  // glowing edges. NORMAL blend (depthTest) so the edge keeps its hue over the fill;
  // additive HDR would sum toward white and lose the color separation between kinds.
  const edgesGeo = new EdgesGeometry(geometry, edgeThreshold)
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo)
  const lineMat = new LineMaterial({
    color: new Color().setRGB(...edgeRGB).getHex(),
    linewidth: lineWidth,
    worldUnits: false,
    transparent: true,
    depthTest: true,
    fog: true, // fade in through the tube fog as it approaches
  })
  lineMat.color.setRGB(...edgeRGB) // preserve HDR (>1) components for strong bloom
  const edges = new LineSegments2(lineGeo, lineMat)
  edgesGeo.dispose()

  const inner = new Group()
  inner.add(fill)
  inner.add(edges)

  return {
    inner,
    fillMat,
    lineMat,
    setOpacity(o: number): void {
      fillMat.opacity = fillOpacity * o
      lineMat.opacity = o
    },
    setResolution(w: number, h: number): void {
      lineMat.resolution.set(w, h)
    },
  }
}
