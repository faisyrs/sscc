// Kult of Speed measuring token v1.0. All dimensions millimetres.
// 2 x 8 inches, 3 mm thick, 2 mm sticker inset, 0.2 mm pocket.
// Open triangular notches at each 1-inch station along both long edges.
W=50.8; L=203.2; T=3.0;
inset=2.0; recess=0.2;
notch_base=1.6;       // opening length along outer edge (Y axis)
notch_depth=1.7;      // penetration into the body (X axis)
overcut=0.5;         // ensure boolean extends outside edge and below/above token
module notch_left(y) {
    // Triangle base is outside the body, tip points toward sticker.
    linear_extrude(height=T+2*overcut)
      polygon(points=[[-overcut,y-notch_base/2],
                      [-overcut,y+notch_base/2],
                      [notch_depth,y]]);
}
module notch_right(y) {
    linear_extrude(height=T+2*overcut)
      polygon(points=[[W+overcut,y-notch_base/2],
                      [W+overcut,y+notch_base/2],
                      [W-notch_depth,y]]);
}
difference() {
    cube([W,L,T]);
    // Sticker pocket, top only.
    translate([inset,inset,T-recess])
      cube([W-2*inset,L-2*inset,recess+overcut]);
    // These cutters intersect the ENTIRE body, not merely the raised rim.
    for(i=[1:7]) {
        translate([0,0,-overcut]) notch_left(i*25.4);
        translate([0,0,-overcut]) notch_right(i*25.4);
    }
}
