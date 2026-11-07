// Measuring token, split in two halves for printers with a small bed.
// Same token as token_2x8.scad (2 x 8 in, 3 mm thick, 2 mm sticker inset,
// 0.2 mm pocket, 1-inch notches), split at the 4-inch station and joined
// with dovetails. Each half is 50.8 x about 106.6 mm. Both halves fit
// side by side on a 142 mm (5.6 in) bed: part = "plate".
//
// Export one STL per part:
//   openscad -D 'part="a"'     -o token_half_a.stl token_2x8_split.scad
//   openscad -D 'part="b"'     -o token_half_b.stl token_2x8_split.scad
//   openscad -D 'part="plate"' -o token_plate.stl  token_2x8_split.scad
// part = "assembled" shows the joined token, for checking only.
//
// Print flat, pocket side up. Push the halves together and glue the joint;
// the sticker then covers the seam.

part = "plate";            // "a", "b", "plate" or "assembled"
double_sided = false;      // true adds a sticker pocket on the bottom face too
clearance = 0.15;          // gap around each dovetail; raise it if the joint is too tight

W = 50.8; L = 203.2; T = 3.0;
inset = 2.0; recess = 0.2;
notch_base = 1.6; notch_depth = 1.7; overcut = 0.5;
split = L / 2;             // the 4-inch station

// Dovetails: narrow at the seam, wide at the tip, so the halves can't pull apart.
tail_neck = 7; tail_tip = 10; tail_depth = 5;
tail_x = [W * 0.27, W * 0.73];   // centres, clear of the edge notches

module notch(x_edge, dir, y) {
    linear_extrude(height = T + 2 * overcut)
        polygon([[x_edge - dir * overcut, y - notch_base / 2],
                 [x_edge - dir * overcut, y + notch_base / 2],
                 [x_edge + dir * notch_depth, y]]);
}

module token() {
    difference() {
        cube([W, L, T]);
        translate([inset, inset, T - recess]) cube([W - 2 * inset, L - 2 * inset, recess + overcut]);
        if (double_sided)
            translate([inset, inset, -overcut]) cube([W - 2 * inset, L - 2 * inset, recess + overcut]);
        for (i = [1:7]) {
            translate([0, 0, -overcut]) notch(0, 1, i * 25.4);
            translate([0, 0, -overcut]) notch(W, -1, i * 25.4);
        }
    }
}

// The dovetails stick out of half A into half B. grow widens them (for B's sockets).
module tails(grow = 0) {
    for (x = tail_x)
        translate([0, 0, -overcut])
            linear_extrude(height = T + 2 * overcut)
                offset(delta = grow)
                    polygon([[x - tail_neck / 2, split - 0.01], [x + tail_neck / 2, split - 0.01],
                             [x + tail_tip / 2, split + tail_depth], [x - tail_tip / 2, split + tail_depth]]);
}

module half_a() {
    intersection() {
        token();
        union() {
            translate([-1, -1, -1]) cube([W + 2, split + 1, T + 2]);
            tails();
        }
    }
}

module half_b() {
    difference() {
        intersection() {
            token();
            translate([-1, split, -1]) cube([W + 2, L, T + 2]);
        }
        tails(clearance);
    }
}

if (part == "a") half_a();
else if (part == "b") translate([0, -split, 0]) half_b();
else if (part == "assembled") { half_a(); half_b(); }
else {
    // Both halves on one plate, side by side, 4 mm apart, within a 106 x 107 mm area.
    half_a();
    translate([2 * W + 4, split + tail_depth, 0]) rotate([0, 0, 180]) translate([0, -split, 0]) half_b();
}
