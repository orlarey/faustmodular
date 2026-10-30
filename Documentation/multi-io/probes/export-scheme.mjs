// Validates the building blocks of the proposed Faust export (see PLAN.md, section 4.4):
//  1. `route` sums signals routed to the same output (fan-in);
//  2. the "bus / stage / route / ~" scheme on a graph with fan-out and feedback.
// Usage: node Documentation/multi-io/probes/export-scheme.mjs
import { render } from "./faust-env.mjs";

console.log("route fan-in:", await render("route_sum", "process = route(2,1,(1,1),(2,1));", [1, 2]));

// Graph: ext.in0 -> A.in0 ; A.out0 -> B.in0 ; A.out1 -> B.in1 and ext.out1 ;
//        B.out0 -> ext.out0 ; B.out0 -> A.in0 (feedback, back edge)
// Expected (x = 1): t0 = (5.5, 10), t1 = (35.75, 65), ...
const code = `import("stdfaust.lib");
A = _ <: _, *(10);                 // 1 in, 2 out
B = + : *(0.5);                    // 2 in, 1 out
// bus: [fb | ext0] -> stage A -> [fb, ext0, A0, A1] -> stage B -> [.., B0]
stageA = si.bus(2) <: si.bus(2), (route(2,1,(1,1),(2,1)) : A);
stageB = si.bus(4) <: si.bus(4), (route(4,2,(3,1),(4,2)) : B);
core = stageA : stageB : route(5,3,(5,1),(5,2),(4,3));   // [fb = B0, out0 = B0, out1 = A1]
process = core ~ _ : (!, _, _);
`;
console.log("graph:", await render("graph", code, [1], 6));
