---
title: Une bibliothèque de synthèse modulaire
subtitle: Modules Faust pour faustmodular, organisés comme ModularGrid, avec des conventions de signal communes
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 1er novembre 2026
document-style: article-a4
language: fr
---

::: toc+
- **Objet** — pourquoi une seconde bibliothèque.
- **La taxonomie de ModularGrid** — les fonctions retenues et celles qui n'ont pas de sens ici.
- **Les conventions de signal** — audio, CV, hauteur, portes et déclencheurs.
- **Un module, des réglages modulables** — les entrées de CV sont les modulations de widgets.
- **Le premier ensemble de modules** — une vingtaine, de quoi faire une voix et la séquencer.
- **L'organisation dans l'application** — où ranger une bibliothèque de plus.
- **Les tests** — ce qui est vérifié pour chaque module.
- **Décisions à prendre.**
:::

# Objet

La bibliothèque actuelle vient de FaustPlayground : des instruments et des effets complets, conçus pour des enfants et pour l'accéléromètre des téléphones (« Instrument Hand », interrupteurs ON/OFF). Elle se prête mal à la synthèse modulaire, où l'on assemble des fonctions élémentaires : un oscillateur, un filtre, un amplificateur, une enveloppe, une horloge, un séquenceur.

Une seconde bibliothèque, **orientée synthèse modulaire**, reprend le vocabulaire et l'organisation des modules Eurorack, avec des **conventions de signal communes** à tous les modules : c'est ce qui permet de tout brancher sur tout, comme dans un rack.

# La taxonomie de ModularGrid

[ModularGrid](https://modulargrid.net/e/modules/browser) classe près de 19 000 modules Eurorack par **fonction** (deux fonctions par module : « 1st Function », « 2nd Function »), dans une liste plate de 61 fonctions. Nous la reprenons, sans les fonctions qui relèvent du matériel (Blank Panel, Power, Expander, PreAmp, Tube, TrueGrid, Video, MIDI, External, Tuner, Controller, Expression) ou qui sont implicites dans faustmodular (**Multiple** : une sortie alimente autant d'entrées qu'on veut ; **Dual/Stereo**, **Quad** : des variantes).

```csv "Les fonctions retenues, groupées" \label{tab:fonctions}
Famille,Fonctions de ModularGrid
Sources,Oscillator · Noise · Drum · Voice · Synth · Resonator · Sampling
Modifier le timbre,Filter · Low Pass Gate · Waveshaper · Distortion · Fuzz · Ring Modulator · Equalizer · Phase Shifter · Pitch Shifter
Niveau et mélange,VCA · Mixer · Panning · Dynamics · Attenuator · Polarizer · Precision Adder
Contrôle,Envelope Generator · Function Generator · LFO · Envelope Follower · Slew Limiter · CV Modulation
Temps et événements,Clock Generator · Clock Modulator · Frequency Divider · Sequencer · Shift Register · Logic · Comparator · Switch
Hasard et hauteur,Random · Sample and Hold · Quantizer
Effets,Delay · Reverb · Looper · Effect
Mesure,les modules d'affichage de faustmodular (Level, Value, Scope, Spectrum)
```

Chaque module de la bibliothèque déclare ses fonctions (`declare function "Oscillator";`, et une seconde au besoin), ce qui permet de filtrer comme sur ModularGrid.

# Les conventions de signal

Dans un rack, tout est tension : l'audio fait ±5 V, les CV ±5 V ou 0–10 V, la hauteur suit **1 V par octave**, les portes valent 5 à 10 V. Dans faustmodular, tout est nombre. La proposition : **la tension divisée par 10**, pour que tout tienne dans [−1, 1], l'intervalle que la modulation ± de faustmodular sait déjà exploiter (+1 mène un réglage à son maximum, −1 à son minimum).

```csv "Les conventions proposées" \label{tab:conventions}
Signal,Rack,faustmodular
Audio,±5 V,±1 (pleine échelle)
CV bipolaire (LFO),±5 V,±1
CV unipolaire (enveloppe),0–10 V,0–1
Hauteur,1 V/oct,0.1 par octave ; 0 = do 4 (261.63 Hz) ; ±1 = ±10 octaves
Porte (gate),0 / 5–10 V,0 / 1 (haute tant que la note dure)
Déclencheur (trigger),impulsion de 1 à 10 ms,0 / 1 pendant 1 ms
Horloge,impulsions,déclencheurs ; une entrée de porte accepte aussi une horloge
```

Une entrée de porte considère qu'elle est haute au-dessus de 0.5 (avec hystérésis), comme les comparateurs des modules analogiques ; une entrée de déclenchement réagit au front montant.

Le choix de la hauteur est le plus engageant : **0.1 par octave** garde les hauteurs dans [−1, 1] (dix octaves de part et d'autre du do 4) et rend les transpositions additives (un mixeur ou un « Precision Adder » transpose). La variante « 1 par octave » est plus lisible dans un afficheur, mais sort de [−1, 1] dès une octave.

# Un module, des réglages modulables

Un module Eurorack a un bouton et une entrée CV par paramètre, souvent avec un atténuateur. Dans faustmodular, **chaque réglage est déjà une entrée de CV** : relâcher un câble sur un widget le module, avec une profondeur réglable sur son port, qui joue le rôle de l'atténuateur. D'où la règle de la bibliothèque : **un port pour le signal que le module transforme, un réglage pour tout ce qui le commande**.

- **Ports** : l'audio d'un filtre, d'un amplificateur, d'un mixeur, et le signal d'un module de traitement de CV (Offset, Quantizer, SampleHold).
- **Réglages** : la hauteur d'un oscillateur ou d'un filtre, la FM, le gain d'un amplificateur, les portes, les déclencheurs, les horloges et les remises à zéro. Une interface complète, que l'on joue à la main (un bouton *Gate* pour l'ADSR, *Clock* pour avancer le séquenceur pas à pas) et que la modulation pilote.

Chaque sorte de widget a son mode de modulation (`allowedModes`) :

```csv "Modes de modulation des réglages" \label{tab:modes}
Réglage,Mode,Effet,Exemple
Curseur de hauteur [unit:pitch],+ additionner,w + A·m (A = 1 par défaut),séquenceur → Pitch du VCO : juste quelle que soit la position du curseur
Curseur déclarant [mod:lin],~ FM linéaire,w·(1 + D·m) (D = 1 par défaut ; jusqu'à −max),SineVCO → Freq d'un autre SineVCO : la FM classique
Curseur de fréquence [unit:Hz] ou [scale:log],± moduler,exponentiel : en octaves,enveloppe → Cutoff du VCF
Autre curseur,± moduler,linéaire autour du curseur (D = 0.5 par défaut),ADSR → Gain du VCA (curseur à 0 et D = 1 : le gain est l'enveloppe)
Bouton,⇐ piloter,le signal remplace le bouton,horloge → Clock du séquenceur ; porte → Gate de l'ADSR
```

Le ± n'additionne pas : son excursion dépend de la position du curseur, ce qui fausserait une hauteur. Le mode « + additionner » (`Documentation/widget-modulation/MODULATION.md`) donne aux curseurs de hauteur la sémantique du bouton et de l'entrée 1 V/oct d'un oscillateur ; sa quantité A est le suivi de clavier d'un filtre.

Un widget a une seule modulation, mais une modulation accepte plusieurs sources, qui s'additionnent : un câble relâché sur son port ajoute une source (le séquenceur et un LFO de vibrato sur la hauteur).

**Pas de lissage.** La modulation remplace le widget dans le code : tout ce qui suit le widget filtre aussi le signal. `si.smoo` est un passe-bas d'ordre 1 de pôle 1 − 44.1/SR (constante de temps 22.7 ms, coupure vers 7 Hz) : il supprimerait la FM audio, et un saut de hauteur d'une octave mettrait 160 ms à s'établir à 1 cent près. Les réglages de la bibliothèque ne sont donc pas lissés ; déplacés à la main, ils avancent par blocs (128 échantillons, 2.7 ms à 48 kHz). Un test le vérifie.

# Le premier ensemble de modules

Une vingtaine de modules, de quoi construire une voix complète et la jouer avec un séquenceur :

```csv "Premier ensemble" \label{tab:modules}
Module,Fonctions,Ports,Réglages
VCO,Oscillator,V/oct · FM → sinus · triangle · scie · carré,accord fin · forme (menu) · largeur d'impulsion
Noise,Noise,→ blanc · rose,niveau
VCF,Filter,audio · V/oct → passe-bas · passe-haut · passe-bande,coupure · résonance · suivi de clavier
VCA,VCA,audio · CV → audio,gain · réponse (linéaire / exponentielle)
LPG,Low Pass Gate,audio · CV → audio,mode (VCA / filtre / les deux) · décroissance
ADSR,Envelope Generator,porte → enveloppe,attaque · déclin · maintien · relâchement
AD,Envelope Generator · Function Generator,déclencheur → enveloppe,attaque · déclin · courbe
LFO,LFO,remise à zéro → sortie,fréquence · forme (menu) · bipolaire / unipolaire
Mixer,Mixer,4 entrées → sortie,4 niveaux
Offset,Attenuator · Polarizer · Precision Adder,entrée → sortie,gain (−1..1) · décalage
Slew,Slew Limiter,entrée → sortie,montée · descente
Clock,Clock Generator,remise à zéro → horloge,tempo (BPM) · largeur
Divider,Clock Modulator · Frequency Divider,horloge → /2 · /3 · /4 · /8,—
Sequencer,Sequencer,horloge · remise à zéro → hauteur · porte,8 pas (hauteur · porte) · longueur
S&H,Sample and Hold · Random,entrée · déclencheur → sortie,— (bruit interne sans entrée)
Quantizer,Quantizer,hauteur → hauteur,gamme (menu) · tonique
Logic,Logic · Comparator,A · B → et · ou · ou exclusif · non,seuil
Switch,Switch,déclencheur · 4 entrées → sortie,—
Folder,Waveshaper,audio → audio,repliement · symétrie
Ring,Ring Modulator,A · B → A·B,mélange
Delay,Delay,audio → audio,temps · réinjection · mélange
Reverb,Reverb,audio → audio,taille · amortissement · mélange
```

Ce tableau est la proposition initiale. Depuis 3.9.0, les portes, déclencheurs, horloges et hauteurs des modules sont des réglages (section précédente) : les ports des douze premiers modules sont dans le tableau \ref{tab:etat}, et les modules suivants suivront la même règle.

Les sources de modulation actuelles (LFO, QuadLFO, Random, Clock, ADSR, EnvelopeFollower) sont reprises dans cette bibliothèque et alignées sur ces conventions.

# L'organisation dans l'application

La bibliothèque actuelle occupe déjà sept colonnes. Une organisation par fonctions demande une autre présentation :

- un **sélecteur de bibliothèque** en tête du menu Library : « Modulaire » (nouvelle) et « FaustPlayground » (l'actuelle) ;
- pour la bibliothèque modulaire, une colonne de **familles** (tableau \ref{tab:fonctions}) et une colonne des modules de la famille choisie, avec la description du module survolé (son commentaire `DESCRIPTION`).

Les deux bibliothèques suivent les mêmes règles de préservation (index des empreintes, statut déduit du contenu).

# Les tests

Pour chaque module, rendu hors ligne avec le compilateur de l'application (comme `tests/library/modulation-sources.test.ts`) :

- nombre d'entrées et de sorties ;
- plages de sortie conformes aux conventions (audio dans ±1, CV dans [−1, 1] ou [0, 1], portes 0/1) ;
- hauteur : le VCO joue 261.63 Hz pour 0, le double pour 0.1, et suit une octave par 0.1 sur dix octaves (erreur < 1 cent) ;
- portes et déclencheurs : seuil, front montant, durée du déclencheur ;
- un patch de référence (Clock → Sequencer → Quantizer → VCO → VCF → VCA ← ADSR) produit une suite de notes justes.

# Décisions

Prises le 1er novembre 2026 :

1. **Échelle de hauteur** : 0.1 par octave, 0 = do 4 (261.63 Hz).
2. **Organisation** : un sélecteur « Modulaire / FaustPlayground » en tête du menu Library ; pour la bibliothèque modulaire, des familles de fonctions, leurs modules et la description du module pointé ; « Mes modules » à côté de l'une ou l'autre.
3. **Premier ensemble** : une voix d'abord, douze modules : VCO, Noise, VCF, VCA, ADSR, LFO, Mixer, Offset, Clock, Sequencer, Quantizer, SampleHold.
4. **Des réglages plutôt que des entrées de contrôle** (3.9.0) : des modules à l'interface complète, pilotés par la modulation de widget ; un mode « + additionner » pour les curseurs de hauteur.

::: note [État, faustmodular 3.11.0]
Les douze modules sont dans `public/faust-modules/modular/`, avec les modules d'affichage dans la famille « Mesure ». Le catalogue (`modular-catalog.json`) est produit par `npm run library-index` à partir des déclarations des modules : `declare function "..."` (et `function2`), `declare summary "..."`, `declare inlets "..."` et `declare outlets "..."` (les noms des ports, écrits à côté d'eux sur la scène depuis 3.10.0 et repris dans leur infobulle ; `inputs` et `outputs` sont des mots réservés de Faust) et le commentaire `DESCRIPTION`. Les libellés des menus ne contiennent pas de tiret : le JSON d'un DSP compilé délimite ces libellés par des tirets. Faust ordonne les widgets en comparant leurs préfixes `[n]` comme des chaînes : au-delà de dix, ils s'écrivent sur deux chiffres (`[01]`, …, `[10]`).

Depuis 3.9.0, les ports ne portent que les signaux transformés :

```csv "Ports et réglages pilotables" \label{tab:etat}
Module,Ports (entrées → sorties),Réglages pilotés par modulation
VCO,→ sine · triangle · saw · square,Pitch (+) · Octave · Tune · FM (octaves) · Width
SineVCO,→ sine,Freq (~ FM linéaire) · Gain
Noise,→ white · pink,Level
VCF,audio → audio,Mode · Cutoff (octaves) · Pitch (+ : suivi de clavier) · Resonance
VCA,audio → audio,Gain · Response
ADSR,→ envelope,Gate (bouton) · Attack · Decay · Sustain · Release
LFO,→ LFO,Rate · Shape · Polarity · Reset (bouton)
Mixer,4 entrées → mix,Level 1 à 4
Offset,in → out,Gain · Offset · Transpose
Clock,→ clock,Tempo · Division · Width · Reset (bouton)
Sequencer,→ pitch · gate,Clock (bouton) · Reset (bouton) · Step 1 à 8 · Length
Quantizer,pitch → pitch,Scale · Tonic
SampleHold,in → out,Trigger (bouton) · Source
```

Les tests (`tests/library/modular.test.ts`) rendent les modulations par le code effectif de l'application, avec le mode qu'elle propose pour chaque widget. Ils vérifient :

- les arités et les modes ;
- l'absence de lissage ;
- la hauteur ajoutée, juste à moins de 1 cent quelle que soit la position du curseur ;
- la FM à fréquence audio, par ses bandes latérales ;
- les portes, horloges et déclencheurs pilotés.

Le SineVCO (3.11.0) est l'oscillateur le plus simple : une fréquence en Hz, un gain. Deux SineVCO font de la FM classique : le spectre mesuré suit celui de Chowning, fc ± k·fm avec les amplitudes |J_k(I)|, à moins de 5·10⁻⁴ près pour une amplitude de 0.5, y compris quand la fréquence passe par zéro. Il ne remplace pas le VCO complet : sa fréquence n'a pas d'entrée de hauteur à 0.1 par octave, un séquenceur ne le joue donc pas juste.

Un test de bout en bout joue la voix séquencée : Clock → Clock du Sequencer, pitch → Quantizer → Pitch du VCO, gate → Gate de l'ADSR, enveloppe → Gain du VCA. Elle est juste à moins de 5 cents.
:::
