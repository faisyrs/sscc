// Measuring token, one piece. All dimensions in millimetres.
// 2 x 8 in, 3 mm thick, with a sticker pocket 2 mm in from the edge that is
// 1 mm deep with a rounded rim, and a decorative 1 mm notch at each inch on
// both long edges. Needs a bed at least 203.2 mm long, or 150 mm square if
// printed along the diagonal. For smaller beds, use token_2x8_split.scad,
// which is the same token split in two dovetailed pieces.

double_sided = false;      // true adds the same pocket on the bottom face (for resin printers)

W = 50.8; L = 203.2; T = 3.0;
inset = 2.0;               // border around the sticker; the pocket is 46.8 x 199.2 mm
recess = 1.0;              // pocket depth
rim_r = 0.5;               // radius of the rounded pocket rim (0 for a square edge)
rim_steps = 8;
notch_base = 1.6; notch_depth = 1.0; overcut = 0.5;

module notch(x_edge, dir, y) {
    linear_extrude(height = T + 2 * overcut)
        polygon([[x_edge - dir * overcut, y - notch_base / 2],
                 [x_edge - dir * overcut, y + notch_base / 2],
                 [x_edge + dir * notch_depth, y]]);
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
    cube([W, L, T]);
    pocket();
    if (double_sided) translate([0, 0, T]) mirror([0, 0, 1]) pocket();
    for (i = [1:7]) {
        translate([0, 0, -overcut]) notch(0, 1, i * 25.4);
        translate([0, 0, -overcut]) notch(W, -1, i * 25.4);
    }
}
