// Single place for coordinate-frame conversion between the CFD / OpenUSD stage frame and the web renderer.
// CFD export and USD stage: X rearward along the bus, Y lateral (doors at +Y), Z up, metres
// (stage metadata upAxis = "Z", metersPerUnit = 1).  The three.js scene uses the SAME frame (camera.up = +Z),
// so the conversion is the identity; every camera, probe, label, slice and pick goes through these functions,
// so a different renderer convention would only need to change this file.
export const UP = [0, 0, 1];
export const cfdToWorld = (p) => [p[0], p[1], p[2]];
export const worldToCfd = (p) => [p[0], p[1], p[2]];
