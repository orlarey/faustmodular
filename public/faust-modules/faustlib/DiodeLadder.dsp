declare name "Diode Ladder";
declare author "Faust libraries";
declare source "ve.diodeLadder (vaeffects.lib), corrected";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Virtual analog model of the diode ladder (EMS, Roland TB-303), after a saturation of the input
- Q from 0.707 to 20: the resonance; the cutoff stays at -3 dB whatever the resonance (the peak of the resonance below it, at 0.68 of the cutoff for Q = 20)
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- The function of the library corrected: the feedback through its second stage, its feedback independent of the frequency
- From the Faust libraries: ve.diodeLadder (vaeffects.lib), corrected

*/

// ve.diodeLadder of vaeffects.lib (Eric Tarr, after Will Pirkle), with two changes:
// - the feedback through the second stage uses SG2 = G4*G3, as the derivation does (the library uses SG3,
//   and defines SG2 without using it, which detunes the filter as the feedback rises: up to 280 cents at
//   10 kHz); the filter is then the bilinear transform of the analog ladder (measured within 4 cents);
// - its arguments: g = tan(pi f/SR), the frequency of the stages prewarped, and k, the feedback. The library
//   computes k from Q and lowers it above 5 kHz, (17 - nf^10*9.7) (Q - 0.707)/(25 - 0.707); here k depends
//   on Q alone: a bilinear transform keeps the filter stable for k < 17 (the threshold of self oscillation).
process = diodeLadder(g, k);

cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 1, 0.707, 20, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);

// the feedback, from 0 (Q = 0.707) to 13.5 (Q = 20)
k = 17 * (q - 1 / sqrt(2)) / (25 - 1 / sqrt(2)) : max(0);

// The analog ladder (its four stages coupled, at the frequency 1): H(s) = 1/(D(s) + k),
// D(s) = 8s^4 + 32s^3 + 40s^2 + 16s + 1. Its -3 dB frequency w, |D(jw) + k|^2 = 2 (1 + k)^2, is in u = w^2
// the only positive root (one change of sign) of u^4 + 6u^3 + (9 + a/4)u^2 + (4 - 5a/4)u - a^2/64, a = 1 + k:
// found by bisection, 20 steps from 0.05 to 1.2 (w = 0.0747 for k = 0, 0.963 for k = 13.5).
w = bisect(20, 0.05, 1.2)
with {
    a = 1 + k;
    F(u) = u * (u * (u * (u + 6) + 9 + a / 4) + 4 - 1.25 * a) - a * a / 64;
    bisect(0, lo, hi) = sqrt(lo * hi);
    bisect(n, lo, hi) = bisect(n - 1, select2(above, lo, m), select2(above, m, hi))
    with {
        m = sqrt(lo * hi);
        above = F(m * m) < 0;   // the root above m
    };
};

// the stages tuned so that the ladder is at -3 dB at the cutoff (the bilinear transform scales tan(pi f/SR))
g = tan(ma.PI * fc / ma.SR) / w;

diodeLadder(g, k) = ef.cubicnl(1, 0) * 1.5 <: (s1, s2, s3, s4, y) : !, !, !, !, _
    letrec{
      's1 = _-(s4*B4*SG4*k) : 
        _-((s4*B4*d3+s3)*B3*SG3*k) : 
        _-(((s4*B4*d3+s3)*B3*d2 + s2)*B2*SG2*k) :
        _-((((s4*B4*d3+s3)*B3*d2 + s2)*B2*d1 + s1)*B1*SG1*k) :
        _*alpha0: _*gam1 : _+((s4*B4*d3+s3)*B3*d2 + s2)*B2 : //_+S2
        _+((((s4*B4*d3+s3)*B3*d2 + s2)*B2)*d1 + s1)*B1*G2 : // _ + (S2 ...
        _*a1 : _-s1 :_*alpha*2 : _+s1;

      's2 = _-(s4*B4*SG4*k) : 
        _-((s4*B4*d3+s3)*B3*SG3*k) : 
        _-(((s4*B4*d3+s3)*B3*d2 + s2)*B2*SG2*k):
        _-((((s4*B4*d3+s3)*B3*d2 + s2)*B2*d1 + s1)*B1*SG1*k) :
        _*alpha0: _*gam1 : _+((s4*B4*d3+s3)*B3*d2 + s2)*B2 : //_+S2
        _+((((s4*B4*d3+s3)*B3*d2 + s2)*B2)*d1 + s1)*B1*G2 : // _ + (S2 ...
        _*a1 : _-s1 :_*alpha : _+s1 : _*gam2 :
        _+(s4*B4*d3 + s3)*B3 : //_+S3 :
        _+(((s4*B4*d3 + s3)*B3)*d2 + s2)*B2*G3 : //_+(S3...)
        _*a2 : _-s2 : _*alpha*2 : _+s2;

      's3 = _-(s4*B4*SG4*k) : 
        _-((s4*B4*d3+s3)*B3*SG3*k) : 
        _-(((s4*B4*d3+s3)*B3*d2 + s2)*B2*SG2*k) :
        _-((((s4*B4*d3+s3)*B3*d2 + s2)*B2*d1 + s1)*B1*SG1*k) :
        _*alpha0 : _*gam1 : _+((s4*B4*d3+s3)*B3*d2 + s2)*B2 : //_+S2
        _+((((s4*B4*d3+s3)*B3*d2 + s2)*B2)*d1+s1)*B1*G2 : // _ + (S2 ...
        _*a1 : _-s1 :_*alpha : _+s1 : _*gam2 :
        _+(s4*B4*d3 + s3)*B3 : //_+S3 :
        _+(((s4*B4*d3 + s3)*B3)*d2 + s2)*B2*G3 : //_+(S3...)
        _*a2 : _-s2 : _*alpha : _+s2 : _*gam3:
        _+s4*B4 : // _ + S4
        _+((s4*B4)*d3 + s3)*B3*G4: // _ + S4 ...
        _*a3 : _-s3 : _*alpha*2 : _+s3;

      's4 = _-(s4*B4*SG4*k) : 
        _-((s4*B4*d3+s3)*B3*SG3*k) : 
        _-(((s4*B4*d3+s3)*B3*d2 + s2)*B2*SG2*k) :
        _-((((s4*B4*d3+s3)*B3*d2 + s2)*B2*d1 + s1 )*B1*SG1*k) :
        _*alpha0 : _*gam1 : _+((s4*B4*d3+s3)*B3*d2 + s2)*B2 : //_+S2
        _+((((s4*B4*d3+s3)*B3*d2 + s2)*B2)*d1 + s1)*B1*G2 : // _ + (S2 ...
        _*a1 : _-s1 :_*alpha : _+s1 : _*gam2 :
        _+(s4*B4*d3 + s3)*B3 : //_+S3 :
        _+(((s4*B4*d3 + s3)*B3)  *d2+s2)*B2*G3 : //_+(S3...)
        _*a2 : _-s2 : _*alpha : _+s2 : _*gam3 :
        _+s4*B4 : // _ + S4
        _+((s4*B4)*d3 + s3)*B3*G4: // _ + S4 ...
        _*a3 : _-s3 : _*alpha : _+s3 : _*gam4 : _*a4 : _-s4 : _*alpha*2 : _+s4;

      // Output signal
      'y = _-(s4*B4*SG4*k) : 
        _-((s4*B4*d3+s3)*B3*SG3*k) : 
        _-(((s4*B4*d3+s3)*B3*d2 + s2)*B2*SG2*k) :
        _-((((s4*B4*d3+s3)*B3*d2 + s2)*B2*d1 + s1 )*B1*SG1*k) :
        _*alpha0: _*gam1 : _+((s4*B4*d3+s3)*B3*d2 + s2)*B2 : //_+S2
        _+((((s4*B4*d3+s3)*B3*d2 + s2)*B2)*d1 + s1)*B1*G2 : // _ + (S2 ...
        _*a1 : _-s1 :_*alpha : _+s1 : _*gam2 :
        _+(s4*B4*d3 + s3)*B3 : //_+S3 :
        _+(((s4*B4*d3 + s3)*B3)*d2 + s2)*B2*G3 : //_+(S3...)
        _*a2 : _-s2 : _*alpha : _+s2 : _*gam3 :
        _+s4*B4 : // _ + S4
        _+((s4*B4)*d3 + s3)*B3*G4: // _ + S4 ...
        _*a3 : _-s3 : _*alpha : _+s3 : _*gam4 : _*a4 : _-s4 : _*alpha : _+s4;
    }
with {
    G4 = 0.5 * g / (1 + g);
    G3 = 0.5 * g / (1 + g - 0.5 * g * G4);
    G2 = 0.5 * g / (1 + g - 0.5 * g * G3);
    G1 = g / (1.0 + g - g * G2);
    Gamma = G1 * G2 * G3 * G4;
    SG1 = G4 * G3 * G2; // feedback gains
    SG2 = G4 * G3;
    SG3 = G4;
    SG4 = 1;
    alpha = g / (1 + g);
    alpha0 = 1 / (1 + k * Gamma);
    gam1 = 1 + G1 * G2;
    gam2 = 1 + G2 * G3;
    gam3 = 1 + G3 * G4;
    gam4 = 1;
    a1 = 1; // a0 of the stages
    a2 = 0.5;
    a3 = 0.5;
    a4 = 0.5;
    B1 = 1 / (1 + g - g * G2);
    B2 = 1 / (1 + g - 0.5 * g * G3);
    B3 = 1 / (1 + g - 0.5 * g * G4);
    B4 = 1 / (1 + g);
    d1 = g;
    d2 = 0.5 * g;
    d3 = 0.5 * g;
};
