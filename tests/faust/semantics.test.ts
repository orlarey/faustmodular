// Faust properties the multi-I/O export relies on (see Documentation/multi-io/PLAN.md).
import { describe, expect, it } from "vitest";
import { compileJson, renderConstant, widgetAddresses } from "../helpers/faust";

describe("Faust semantics used by the export", () => {
    it("route sums the signals routed to the same output", async () => {
        const [out] = await renderConstant("route_sum", "process = route(2,1,(1,1),(2,1));", [1, 2], 4);
        expect(out).toEqual([3, 3, 3, 3]);
    });

    it("bus / route / ~ scheme handles fan-out and feedback", async () => {
        // ext.in0 -> A.in0 ; A.out0 -> B.in0 ; A.out1 -> B.in1 and ext.out1 ;
        // B.out0 -> ext.out0 ; B.out0 -> A.in0 (back edge, one-sample delay)
        const code = `import("stdfaust.lib");
            A = _ <: _, *(10);
            B = + : *(0.5);
            stageA = si.bus(2) <: si.bus(2), (route(2,1,(1,1),(2,1)) : A);
            stageB = si.bus(4) <: si.bus(4), (route(4,2,(3,1),(4,2)) : B);
            core = stageA : stageB : route(5,3,(5,1),(5,2),(4,3));
            process = core ~ _ : (!, _, _);`;
        const [out0, out1] = await renderConstant("graph", code, [1], 3);
        // a(t) = 1 + B0(t-1), B0 = 5.5 a, A1 = 10 a
        expect(out0).toEqual([5.5, 35.75, 202.125]);
        expect(out1).toEqual([10, 65, 367.5]);
    });

    it("instances with identical group labels share their controls; unique labels separate them", async () => {
        const M = 'vgroup("Echo", environment{ process = *(hslider("gain",1,0,1,0.1)); }.process)';
        const shared = await compileJson("shared", `process = ${M}, ${M};`);
        expect(widgetAddresses(shared)).toEqual(["/Echo/gain"]);
        const separate = await compileJson("separate", `process = vgroup("Echo#1",${M}), vgroup("Echo#2",${M});`);
        expect(widgetAddresses(separate)).toHaveLength(2);
    });
});
