import { bundledPalette } from "../vendor/openphotex/index.js";

/*
  METALCR2.ACT is the palette Monster Truck Madness 1 shipped in STARTUP.POD and applied to
  every paletted texture that does not have a same-name .ACT beside it. MTM2 keeps the same
  convention; its archives simply tend to provide a same-name palette for each texture.

  The bytes are OpenPhotex's bundled copy of MTM1 ART/METALCR2.ACT, which lets the viewer
  decode an MTM1 TRUCK.POD on its own, without STARTUP.POD.
*/
export const METALCR2_ACT_NAME = "METALCR2.ACT";

export const METALCR2_PALETTE = bundledPalette("metalcr2Mtm1");
