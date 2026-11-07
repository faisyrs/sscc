// Measuring token, one piece. All dimensions in millimetres.
// 2 x 8 in, 3 mm thick, with a sticker pocket 2 mm in from the edge that is
// 1 mm deep with a rounded rim, a rounded outer top edge, and a decorative
// 1 mm notch at each inch on
// both long edges. Needs a bed at least 203.2 mm long, or 150 mm square if
// printed along the diagonal. For smaller beds, use token_2x8_split.scad,
// which is the same token split in two dovetailed pieces.

double_sided = false;      // true adds the same pocket on the bottom face (for resin printers)

W = 50.8; L = 203.2; T = 3.0;
inset = 2.0;               // border around the sticker; the pocket is 46.8 x 199.2 mm
recess = 1.0;              // pocket depth
rim_r = 0.5;               // radius of the rounded pocket rim (0 for a square edge)
rim_steps = 8;
edge_r = 0.4;              // radius of the rounded outer top edge (0 for a square edge). Above 0.4
                           // the outer and inner roundings meet in a sharp crest at each notch tip.
edge_steps = 10;
notch_base = 1.6; notch_depth = 1.0; overcut = 0.5;

// The token's outline seen from above: the rectangle with the notches cut out.
module outline2d() {
    difference() {
        square([W, L]);
        for (i = [1:7]) {
            y = i * 25.4;
            polygon([[-overcut, y - notch_base / 2], [-overcut, y + notch_base / 2], [notch_depth, y]]);
            polygon([[W + overcut, y - notch_base / 2], [W + overcut, y + notch_base / 2], [W - notch_depth, y]]);
        }
    }
}

// The top edge_r mm of the body: thin slices of the outline, each shrunk inward
// along a quarter circle, so the outer edge (sides, corners and notches) is rounded.
module rounded_band() {
    for (i = [0 : edge_steps - 1]) {
        z0 = T - edge_r + edge_r * i / edge_steps;
        z1 = T - edge_r + edge_r * (i + 1) / edge_steps;
        g = edge_r - sqrt(edge_r * edge_r - pow(z1 - T + edge_r, 2));
        translate([0, 0, z0]) linear_extrude(height = z1 - z0 + 0.001) offset(r = -g) outline2d();
    }
}

// The solid token before the pocket is cut. The bottom edge is rounded only when
// double_sided, because a single-sided token prints on that face and gets glued there.
module body() {
    lo = double_sided ? edge_r : 0;
    translate([0, 0, lo]) linear_extrude(height = T - edge_r - lo + 0.001) outline2d();
    if (edge_r > 0) {
        rounded_band();
        if (double_sided) translate([0, 0, T]) mirror([0, 0, 1]) rounded_band();
    }
}

module pocket() {
    pw = W - 2 * inset; pl = L - 2 * inset;
    translate([inset, inset, T - recess]) cube([pw, pl, recess + overcut]);
    if (rim_r > 0)
        for (i = [0 : rim_steps - 1]) {
            z0 = T - rim_r + rim_r * i / rim_steps;
            z1 = T - rim_r + rim_r * (i + 1) / rim_steps;
            g0 = rim_r - sqrt(rim_r * rim_r - pow(z0 - T + rim_r, 2));
            g1 = rim_r - sqrt(rim_r * rim_r - pow(z1 - T + rim_r, 2));
            hull() {
                translate([inset - g0, inset - g0, z0]) cube([pw + 2 * g0, pl + 2 * g0, 0.001]);
                translate([inset - g1, inset - g1, z1]) cube([pw + 2 * g1, pl + 2 * g1, 0.001]);
            }
            if (i == rim_steps - 1)
                translate([inset - g1, inset - g1, z1 - 0.001]) cube([pw + 2 * g1, pl + 2 * g1, overcut]);
        }
}

difference() {
    body();
    pocket();
    if (double_sided) translate([0, 0, T]) mirror([0, 0, 1]) pocket();
}
