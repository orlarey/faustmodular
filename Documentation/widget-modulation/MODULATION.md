---
title: La modulation de widgets
subtitle: Référence de faustmodular 3.12 — le choix du mode, les formules, les ports, l'écriture des modules
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 2 novembre 2026
document-style: article-a4
language: fr
---

::: toc+
- **Le principe** — un câble relâché sur un widget.
- **Le choix du mode** — déduit du widget et de ses métadonnées.
- **Les formules** — une par mode.
- **Les ports de modulation** — profondeur, plage, réglage.
- **La mise en œuvre** — le code effectif, la recompilation, le fondu enchaîné.
- **Écrire un module modulable** — les métadonnées à poser, le lissage à éviter.
- **Remarques et limites.**
:::

Ce document décrit l'état actuel. L'histoire des choix, les mesures qui les ont motivés et les variantes écartées sont dans `PLAN.md`, une section par version.

# Le principe

On tire un câble depuis une sortie audio et on le relâche sur un widget (curseur, bouton, case à cocher) d'un module. Le widget est alors **modulé** au taux audio : le module est recompilé avec la construction Faust de modulation de widgets, qui remplace le widget par un circuit combinant sa valeur et le signal.

- **Un mode par widget, sans choix à faire** : il est déduit du widget visé (section suivante).
- **Une modulation par widget, plusieurs sources** : d'autres câbles relâchés sur le même port de modulation s'ajoutent ; le signal de modulation est leur **somme**, comme pour une entrée audio.
- **Un port par modulation**, à cheval sur le bord gauche du module, à la hauteur du widget. On y règle la profondeur (section « Les ports »). Supprimer le dernier câble d'un port supprime la modulation.

Notations :

```csv "Notations" \label{tab:notations}
Symbole,Sens
w,la valeur du widget telle que réglée à la main
"[min, max]",les bornes du widget (lues dans le JSON du DSP compilé)
m,le signal de modulation : la somme des sources reliées au port
"D, A",la profondeur réglée sur le port (un curseur Faust caché du circuit)
```

# Le choix du mode

Le mode est choisi par `allowedModes` (`src/model/Modulation.ts`), dans cet ordre :

```csv "Choix du mode" \label{tab:choix}
Ordre,Widget,Métadonnée,Mode
1,"button, checkbox",(aucune n'est lue),⇐ piloter
2,"curseur (hslider, vslider, nentry)",[mod:lin],~ FM linéaire
3,curseur,[unit:pitch] ou [mod:add],+ additionner
4,curseur,"[scale:log] ou [unit:Hz], avec min > 0","± moduler, exponentiel"
5,curseur,"aucune des précédentes, ou min ≤ 0","± moduler, linéaire"
```

- La casse des métadonnées est ignorée.
- Quand un curseur porte plusieurs de ces métadonnées, la première ligne qui s'applique l'emporte : `[mod:lin]` passe avant `[unit:pitch]`.
- Seules comptent `mod`, `unit` et `scale`. La métadonnée `modulation` marque les curseurs de profondeur, qui ne sont pas modulables. Les autres (`style`, `tooltip`…) n'ont pas d'effet sur la modulation.
- `[mod:exp]` n'existe pas : le mode exponentiel se déduit de `[scale:log]` ou `[unit:Hz]`. `[scale:log]` règle aussi l'affichage du curseur ; `[unit:Hz]` seul module en exponentiel un curseur affiché linéairement.

# Les formules

Chaque mode remplace le widget par un circuit `f(w, m)` (`circuit`, dans `src/model/Modulation.ts`).

## ± moduler

Le curseur est la position de repos, la profondeur D (de −1 à 1, 0.5 par défaut) l'excursion. Avec u = D·m borné à [−1, 1], m = +1 mène au maximum et m = −1 au minimum quand D = 1 ; l'excursion se mesure en fraction du chemin vers la borne, elle n'est donc pas symétrique quand le curseur n'est pas au centre.

```csv "± moduler" \label{tab:moduler}
Variante,u ≥ 0,u < 0,Borné à
linéaire,w + u·(max − w),w + u·(w − min),"[min, max]"
exponentiel (fréquences),w·(max/w)^u,w·(w/min)^u,"[min, max]"
```

Usages : un LFO sur un niveau, une enveloppe sur un gain (curseur à 0, D = 1 : le gain est l'enveloppe), une enveloppe sur la coupure d'un filtre (en octaves). L'exponentiel ne convient pas à la FM : la fréquence moyenne monte avec la profondeur (+92 cents pour u = 0.1 à 440 Hz sur 20–20 000 Hz).

## + additionner

Pour les curseurs de hauteur, à 0.1 par octave (`Documentation/MODULAR-LIBRARY.md`) :

```
w + A·m        borné à [min, max] ; A de −1 à 1, 1 par défaut
```

Le curseur transpose, le signal est une hauteur ajoutée : la sémantique du bouton et de l'entrée 1 V/oct d'un oscillateur, juste quelle que soit la position du curseur. A dose le suivi (le suivi de clavier d'un filtre). Exemple : séquenceur → *Pitch* du VCO.

## ~ FM linéaire

Pour la fréquence d'un oscillateur, déclarée `[mod:lin]` :

```
w·(1 + D·m)    borné à [−M, M], M = max(|min|, |max|) ; D de −10 à 10, 1 par défaut
```

Le minimum du curseur est ignoré : la fréquence peut passer par zéro, la phase repart alors en arrière (`os.osc` le permet). Avec un modulateur sinusoïdal de gain g à fm sur un porteur à fc, c'est la FM de Chowning : la déviation vaut D·g·fc, l'**indice I = D·g·fc/fm**, la fréquence moyenne reste fc, et le spectre est fc ± k·fm d'amplitudes |J_k(I)|. Exemple : la sortie d'un SineVCO sur la *Freq* d'un autre ; à fréquences égales, le Gain du modulateur est l'indice.

## ⇐ piloter

```
m              borné à [min, max] ; pas de profondeur
```

Le signal remplace le widget, qui reste affiché, grisé. Pour un bouton : une porte ou un déclencheur (horloge → *Clock* d'un séquenceur, porte → *Gate* d'une ADSR).

Le circuit ajoute un bargraphe caché, `[driven:<cible>][hidden:1]`, qui rapporte à l'interface la valeur donnée au widget : un bouton piloté s'allume tant que le signal le tient à 1, la LED d'une case à cocher pilotée suit le signal. Comme toute valeur de bargraphe, elle n'arrive que si le module est calculé, c'est-à-dire si sa sortie sert (vers les haut-parleurs, un afficheur…).

## Modes hérités

Les patchs enregistrés avant la version 2.8.0 peuvent porter, sur des curseurs, **× doser** (`w·m`, sans profondeur ni bornes) et **⇐ piloter**. Ils se chargent et sonnent comme avant (`supportedModes`), mais ne sont plus proposés.

# Les ports de modulation

```csv "Ports de modulation" \label{tab:ports}
Mode,Icône,Curseur de profondeur,Plage,Défaut,Glisser vertical (Maj : fin)
± moduler,±,depth <cible>,−1 à 1,0.5,"0.01 par pixel (0.001)"
+ additionner,+,amount <cible>,−1 à 1,1,"0.01 par pixel (0.001)"
~ FM linéaire,∿,deviation <cible>,−10 à 10,1,"0.1 par pixel (0.01)"
⇐ piloter,→,—,—,—,—
```

- L'anneau du port montre |D| rapporté à la plage, dans le sens horaire pour une valeur positive. Un double-clic remet la valeur par défaut.
- La profondeur se règle **en direct, sans recompilation** : c'est un curseur Faust du circuit (`[modulation:<cible>]`, caché dans l'interface), lissé par `si.smoo` (constante de temps de 23 ms). Le lissage porte sur D, pas sur m.
- Elle est enregistrée avec le module, et **mémorisée** quand la modulation est retirée : remodulé, par la même source ou une autre, le widget retrouve sa profondeur. Une profondeur mémorisée égale à sa valeur par défaut n'est pas conservée.
- `<cible>` est le nom du widget (le plus court suffixe de son chemin qui le désigne sans ambiguïté) ; la profondeur garde son nom quand d'autres modulations du module sont ajoutées ou retirées.

# La mise en œuvre

**Le code effectif.** Un module de n entrées audio portant k modulations est compilé avec :

```faust
process = route(n+k, n+k, ...) : ["cible1" : c1, ..., "ciblek" : ck -> environment{ <code> }.process];
```

La construction `["cible" : circuit -> expression]` de Faust remplace chaque widget désigné par `circuit(widget, m)`, m étant une nouvelle entrée placée avant les entrées de l'expression ; le `route` remet les n entrées audio en tête (ports 0 à n−1) et les modulations après (ports n à n+k−1).

**La recompilation.** Ajouter ou retirer une modulation recompile le module ; ses réglages sont rappelés sur le nouveau DSP. Changer une profondeur ne recompile pas.

**Le fondu enchaîné.** Le nouveau DSP partage les entrées et les sorties de l'ancien, chacun derrière son propre gain : après 20 ms (le temps que les réglages rappelés parviennent au nouveau DSP), l'ancien décroît et le nouveau croît, linéairement, en 50 ms ; l'ancien est ensuite détruit (`src/audio/AudioGraph.ts`). Les câbles ne changent pas : les autres modules ne s'aperçoivent de rien. L'état interne (phase, enveloppes, lignes à retard) n'est pas transféré.

# Écrire un module modulable

- **Un réglage plutôt qu'une entrée de contrôle.** Tout réglage est une entrée de CV : les ports d'un module portent les signaux qu'il transforme, ses réglages tout ce qui le commande (`Documentation/MODULAR-LIBRARY.md`).
- **Pas de lissage après un widget modulable.** La modulation remplace le widget : ce qui le suit filtre aussi m. `si.smoo` (un passe-bas de 7 Hz environ) supprimerait la FM audio et ferait glisser les notes d'un séquenceur.
- **La métadonnée selon le rôle du réglage :**

```csv "Métadonnées selon le rôle" \label{tab:roles}
Rôle du réglage,Déclaration,Mode obtenu
fréquence d'un oscillateur (FM),"hslider(""Freq[unit:Hz][scale:log][mod:lin]"", 440, 20, 20000, 0.01)",~ FM linéaire
hauteur à 0.1 par octave,"hslider(""Pitch[unit:pitch]"", 0, -1, 1, 0.001)",+ additionner
fréquence de coupure ou vitesse,"hslider(""Cutoff[unit:Hz][scale:log]"", 1000, 20, 20000, 1)","± moduler, exponentiel"
"niveau, gain, mélange","hslider(""Gain"", 0, 0, 1, 0.01)","± moduler, linéaire"
"porte, déclencheur, remise à zéro","button(""Gate"")",⇐ piloter
```

- **Un menu** (`[style:menu{...}]`) modulé reçoit des valeurs continues : c'est au code du module de les arrondir s'il le faut.

# Remarques et limites

- **Pas d'arrondi au pas.** Le circuit produit des valeurs continues, que le widget ait un pas entier ou non.
- **Précision.** En simple précision, une profondeur lissée se stabilise à environ 10⁻⁴ près de sa valeur (3·10⁻⁵ sous 1 pour D = 1) : moins de 0.14 cent pour une hauteur de 4 octaves.
- **Plage de la FM linéaire.** Avec D ≤ 10 et g ≤ 1, l'indice ne dépasse pas 10·fc/fm : un modulateur plus aigu que le porteur limite l'indice atteignable.
- **Un seul mode par widget.** Une fréquence déclarée `[mod:lin]` ne suit pas une hauteur à 0.1 par octave : un séquenceur ne joue pas juste un SineVCO.

# Références

- Code : `src/model/Modulation.ts` (`allowedModes`, `isLinear`, `isPitch`, `isExponential`, `circuit`, `modulatedCode`), `src/view/PatchView.ts` (ports), `src/audio/AudioGraph.ts` (fondu enchaîné).
- Tests : `tests/faust/widget-modulation.test.ts` (la construction Faust), `tests/model/modulation.test.ts` (chaque formule, compilée et exécutée), `tests/library/modular.test.ts` (les modules, dont la FM comparée au spectre de Chowning), `tests/browser/audiograph.test.ts` (le fondu), `tests/e2e/app.test.ts` (le geste et les ports).
- Histoire : `PLAN.md`.
