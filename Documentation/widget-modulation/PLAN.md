# Modulation de widgets — principe, mesures, difficultés, plan

Extension de FaustPlayground 2.0.0 : connecter une **sortie audio** à un **widget** (slider, bouton,
case à cocher) d'un module, pour moduler ce paramètre au taux audio.

Principe retenu :
- **Geste** : on tire un câble depuis un port de sortie et on le lâche sur un widget.
- **Choix du type** : pendant le glisser, au survol d'un widget, une **palette** s'ouvre à côté de
  lui et montre les types de modulation possibles. On lâche le câble sur le type voulu.
- **Mise en œuvre** : le module est recompilé à la volée avec la construction Faust de modulation
  de widgets, `["label" : circuit -> expression]`.

Les mesures de la section 1 sont figées dans `tests/faust/widget-modulation.test.ts`
(libfaust 2.90.17).

---

## 1. Ce que fait Faust (mesuré)

| Construction | Effet |
|---|---|
| `["w" -> e]` | une entrée ajoutée ; chaque widget de label `w` devient `w * m` |
| `["w" : c -> e]`, `c` à 2 entrées | une entrée ajoutée ; le widget devient `c(w, m)` (le widget est le 1er opérande : `-` donne `w - m`) |
| `c` à 1 entrée | pas d'entrée ajoutée ; le widget devient `c(w)` |
| `c` à 0 entrée | pas d'entrée ajoutée ; le widget est remplacé par `c`, et il **disparaît** de l'interface |
| `c = (!, _)` | le widget est remplacé par `m`, et il **disparaît** de l'interface |
| `c = (ro.cross(2) : attach)` | le widget est remplacé par `m`, et il **reste** dans l'interface |

Règles de correspondance et d'ordre :
- **Position des entrées** : les entrées de modulation sont ajoutées **en tête**, avant celles de
  l'expression, une par label, dans l'ordre d'écriture. La forme groupée
  `["a": +, "b": * -> e]` est acceptée.
- **Correspondance** : le label est celui du **source**, sans ses métadonnées
  (`"Volume"` correspond à `Volume[acc:…]`) et avec ses espaces. La forme des adresses
  (`Echo_Delay`) ne correspond pas. Le JSON de la factory fournit ce label dans le champ `label`.
- **Plusieurs widgets du même label** : un label seul les module **tous**. Un suffixe de chemin
  (`"A/gain"`) en sélectionne un ; `"Echo/Delay"` marche avec le groupe qui enveloppe chaque module
  du playground.
- **Modulations imbriquées** : la plus externe s'applique au plus près du widget :
  `["w": + -> ["w": * -> e]]` donne `(w + m₁) · m₂`.
- **Piège** : un label qui ne correspond à rien ajoute **quand même** une entrée, ignorée sans
  avertissement.
- **Boutons et cases à cocher** : avec `*`, la modulation est nulle tant que le contrôle vaut 0.

---

## 2. Conception proposée

### 2.1 Types de modulation (contenu de la palette)

Ce choix suit la pratique des synthés modulaires. En Eurorack comme dans VCV Rack, un paramètre
vaut bouton + profondeur × CV : un atténuverteur dose la modulation, et les niveaux sont
normalisés (LFO bipolaires, enveloppes unipolaires). Les deux exceptions consacrées sont la VCA,
multiplicative, et la hauteur, exponentielle (1 V/octave). Les logiciels (Bitwig, Ableton, Serum)
règlent la profondeur sur la destination et additionnent les modulateurs.

| Choix | Formule (w : valeur du widget, m : signal, D : profondeur) | Rôle |
|---|---|---|
| **± moduler** (par défaut, au centre de la palette) | borné(w + D · m · (max − min)/2) | l'atténuverteur : un LFO dans [−1, 1] à D = 1 balaie toute la plage autour du slider |
| **± moduler**, widget de fréquence | borné(w · 2^(D · m · N)), N = log₂(max/min)/2 octaves | modulation exponentielle, comme le 1 V/octave ; appliquée automatiquement aux widgets marqués `[scale:log]` ou `[unit:Hz]` |
| **× doser** | w · m | la VCA : trémolo, enveloppe appliquée à un niveau |
| **⇐ piloter** | borné(m) | le signal remplace le slider (grisé) ; c'est le seul choix pour les boutons et cases à cocher, comme une entrée gate |

Règles associées :
- **Bornes** : « borné » signifie limité à [min, max] du widget, lus dans le JSON de la factory.
- **Fréquences sans minimum positif** : si `min ≤ 0`, on prend N = 5 octaves, comme si la plage
  couvrait 10 octaves.
- **Profondeur D** : de −1 à 1, valeur initiale 1, pour le mode ±. C'est un slider Faust placé
  dans le circuit de modulation, avec la métadonnée `[modulation]`. Il se règle donc **en direct,
  sans recompilation** (mesuré : D = 1, 0,5, 0, −1 donnent exactement 0,8, 0,65, 0,5, 0,2 pour
  w = 0,5 et m = 0,6). L'interface l'affiche comme un petit bouton à côté du widget modulé, et non
  parmi les contrôles du module.
- **Un seul type par widget** ; plusieurs sources vers un même widget s'additionnent.

### 2.2 Modèle

- **Modulations d'un module** : chaque module reçoit une liste ordonnée
  `modulations: { id, widget: { label, chemin }, type }`. Le **code de base** (celui que l'utilisateur
  édite) reste séparé.
- **Ports** : chaque modulation ajoute un **port d'entrée**. Le module a ses `n` entrées audio,
  puis `k` entrées de modulation, aux indices `n … n+k−1`.
- **Connexions** : les câbles vers une modulation sont des connexions ordinaires du patch.
  Le moteur audio (`AudioGraph`), l'analyse des cycles et l'exporteur n'ont donc **rien de nouveau
  à traiter** : il suffit que le DSP du module soit compilé à partir du **code effectif** et qu'il
  ait `n + k` entrées.
- **Code effectif** : il est généré à partir du code de base et des modulations.

  ```faust
  process = route(n+k, n+k, …)            // nos ports de modulation (en fin) passent en tête
          : ["chemin₁" : c₁, …, "cheminₖ" : cₖ -> environment{ <code de base> }.process];
  ```

- **Partage et ordre** : plusieurs câbles vers le même widget et le même type partagent une seule
  modulation (somme des sources, comme pour les ports audio). Deux types différents sur un même
  widget sont deux modulations, composées dans l'ordre de création.
- **Fin d'une modulation** : quand on supprime le dernier câble d'une modulation, elle disparaît,
  le module est recompilé, et les ports de modulation suivants sont renumérotés par le modèle.

### 2.3 Recompilation dynamique

Créer ou supprimer une modulation recompile le code effectif du module. Le nouveau DSP remplace
l'ancien comme lors d'une édition du code : l'ancien joue jusqu'à ce que le nouveau soit prêt, les
valeurs des paramètres sont conservées et les connexions existantes sont gardées
(`setArity` / `AudioGraph.setNode`).

### 2.4 Interface

- **Cibles** : pendant le glisser d'un câble depuis une sortie, les widgets des modules deviennent
  des cibles (rangées `control-group`), y compris ceux du module d'origine ; ce cas est une
  rétroaction, retardée comme les autres.
- **Palette** : au survol d'un widget, elle s'ouvre à côté de lui avec les types permis. Lâcher sur
  une case crée la modulation. Quitter la zone du widget et de la palette la referme. Lâcher
  ailleurs ne fait rien.
- **Câble de modulation** : il va du port de sortie au bord gauche de la rangée du widget, avec un
  badge du type (×, +, ±, ⇐). Il est en pointillés s'il ferme un cycle ; un clic le supprime.
- **Repères** : un widget modulé porte un liseré coloré, car le curseur ne montre pas la valeur
  modulée au taux audio.
- **Module réduit** : les câbles de modulation aboutissent à la barre de titre.

### 2.5 Fichiers et export

- **Format** : les modules portent `modulations` et leurs ports de modulation. Un fichier sans
  modulation reste en **version 2**. Un fichier avec modulations passe en **version 3** : une 2.0.0
  ne doit pas le lire en ignorant le champ, car les connexions vers des ports de modulation y
  seraient invalides.
- **Export** : il utilise le code effectif de chaque module ; la modulation de widgets fait partie
  du programme Faust exporté, sans code spécifique.

---

## 3. Difficultés

| # | Difficulté | Traitement prévu | Risque |
|---|---|---|---|
| W1 | Désigner le widget dans le source : le chemin du JSON contient des noms de groupes générés (`0x00` pour `h:[1]`), absents du source | plus court suffixe de chemin qui soit unique dans le module et ne contienne pas de nom généré ; refus avec message dans le cas, rare, où il n'y en a pas | moyen |
| W2 | Un label sans correspondance ajoute une entrée en silence | vérifier, après compilation, que le nombre d'entrées vaut `n + k` et que chaque cible est unique dans le JSON | faible |
| W3 | Latence de recompilation (de 0,1 à plus d'1 s pour les gros modules) et remise à zéro de l'état interne du module (queues de réverbération, lignes à retard) | inhérent à la compilation ; indicateur sur le module pendant la compilation, l'ancien DSP joue jusqu'à l'échange | moyen |
| W4 | Renumérotation des ports de modulation quand une modulation disparaît | portée par le modèle (API `addModulation` / `removeModulation`), testée | faible |
| W5 | Palette au toucher : le doigt masque la cible, pas de survol avant contact | palette décalée hors du doigt, délai d'ouverture court ; une palette par pointeur en multi-touch | moyen |
| W6 | Slider d'un widget piloté (⇐) : sa valeur n'a plus d'effet | widget grisé tant que la modulation existe | faible |
| W7 | Limite de 32 entrées | les entrées de modulation comptent dans la limite ; la palette refuse au-delà | faible |
| W8 | Accéléromètre sur un slider modulé | il continue de piloter la valeur de base (×, +, ±), ce qui est cohérent | faible |

---

## 4. Plan

| Phase | Contenu | Validation | Estimation |
|---|---|---|---|
| M0 | Générateur du code effectif (`modulatedCode`) : choix du suffixe de chemin, circuits des 3 types (et variante exponentielle), profondeur, remise en ordre des entrées | tests libfaust : arité `n + k`, valeur de chaque type, profondeur réglée en direct, widgets homonymes, groupes sans nom | 1 j |
| M1 | Modèle et format : modulations, ports, création et suppression avec renumérotation, version 3 | tests unitaires, aller-retour du format | 1 j |
| M2 | Moteur : recompilation dynamique à chaque création ou suppression de modulation | test navigateur : un LFO module un gain, le signal rendu correspond à la formule | 1 j |
| M3 | Interface : widgets cibles, palette, câbles de modulation et badges, suppression, repères | tests de bout en bout à la souris et au toucher (palette, choix, annulation) | 2–3 j |
| M4 | Export (test différentiel avec modulations), modules LFO dans la bibliothèque, exemple « modulation », documentation | test différentiel direct/export ≤ 1e-5 | 1 j |

**Estimation totale : 6 à 7 jours.**

### État (2026-10-30) : M0 à M4 faits

- **M0** — `src/model/Modulation.ts`, avec 11 tests libfaust (`tests/model/modulation.test.ts`).
  - Valeurs des trois types, profondeur réglée en direct, ordre des ports, plusieurs
    modulations, gates, widgets homonymes, labels avec espace avant les métadonnées.
  - Le circuit exponentiel s'écrit `(2.0, _ : pow)` : `pow(2.0)` vaudrait x², car l'application
    partielle d'une primitive fixe son second argument.
- **M1** — Modèle, format et export (`tests/model/modulation-model.test.ts`, 8 tests).
  - Modèle : ports de modulation après les ports audio, renumérotation, limite de 32 entrées,
    rétroaction par une modulation.
  - Format version 3.
  - Export du code effectif.
- **M2** — Recompilation à la volée (`Scene.modulate`, `recompileModulations`).
  - Recompilations en file d'attente par module, sans couper le son.
  - Une modulation disparaît avec son dernier câble.
  - L'édition du code d'un module modulé garde les modulations valides.
  - `ModuleClass.replaceDSP` conserve les valeurs des paramètres. Le chemin d'édition du code
    les réappliquait à l'ancien DSP : c'est corrigé.
  - Test de bout en bout aux valeurs exactes.
- **M3** — Interface (`PatchView`) : widgets cibles, palette après 250 ms, une palette par
  pointeur, câbles au bord du module à la hauteur du widget avec badge, repères des widgets
  modulés, réglage de profondeur compact.
  - Défaut trouvé par l'essai réel : un module sans entrée audio en reçoit une avec sa première
    modulation, avant son nouveau DSP. Le moteur ne relie plus le merger à un nœud sans entrée.
  - Tests de bout en bout à la souris et au toucher.
- **M4** — Sources, exemple et vérification de l'export.
  - Sources de modulation de la bibliothèque (nouvelle colonne « Modulation ») : LFO (4 formes),
    Quad LFO, Random (échantillonné-bloqué), Clock, ADSR, Envelope Follower. Leurs plages
    normalisées sont vérifiées par `tests/library/modulation-sources.test.ts`.
  - Exemple `Modulation_Example.json` : vibrato exponentiel, enveloppe rythmique sur le volume.
  - Test différentiel direct/export avec modulations (les trois types et le cas exponentiel).
    L'écart est d'au plus 2,2·10⁻⁵ pendant le transitoire initial, et sous 10⁻⁷ ensuite : ce
    sont des arrondis float32, différents entre module compilé seul et module inclus dans
    l'export. D'où les seuils : < 10⁻⁴ partout, < 10⁻⁶ sur la seconde moitié.
- **W2** — Le contrôle du nombre d'entrées ne détecte pas un label sans correspondance (Faust
  ajoute l'entrée quand même). Le risque est réduit parce que les cibles sont tirées du JSON
  produit par le même compilateur ; le cas des labels de la bibliothèque est testé.

---

## 5. Décisions (arrêtées le 2026-10-30)

| # | Question | Décision |
|---|---|---|
| 1 | Types de la palette | **± moduler** (par défaut, avec profondeur réglable en direct, exponentiel pour les fréquences), **× doser**, **⇐ piloter** ; plus de « + » brut (§2.1) |
| 2 | Ouverture de la palette | après un **court délai** au survol du widget |
| 3 | Plusieurs types sur un même widget | **non** : un seul type par widget (plusieurs sources s'additionnent) |
| 4 | Sources de modulation dans la bibliothèque | **oui**, comme dans les synthés modulaires : LFO bipolaires [−1, 1] (sinus, triangle, carré, dent de scie), aléatoire échantillonné-bloqué, ADSR déclenchée par une gate [0, 1], suiveur d'enveloppe [0, 1] |

### Évolution (2026-10-31) : ports de modulation

À la demande de l'utilisateur, après les premiers essais : chaque modulation a son **port**, avec
une icône du type et le dosage. Les icônes au trait s'inspirent de faustcode (`orlarey/faustcode`).

- **Position** : le port est placé dans le module, à gauche de son widget, à sa hauteur. Le module
  élargit sa marge gauche (`has-modulations`). Placé sur le bord, le port serait entré en collision
  avec les ports audio d'entrée, centrés sur ce même bord. (Remplacé en 2.3.0 : voir ci-dessous.)
- **Icône** : SVG au trait (± moduler, × doser, → piloter).
- **Profondeur** (mode ±) : un anneau. La longueur de l'arc vaut |profondeur| ; il part du haut et
  tourne dans le sens horaire (orange) si elle est positive, anti-horaire (bleu) si elle est
  négative.
- **Réglage** :
  - glisser verticalement sur le port, à raison de 0,01 par pixel, sans recompilation ;
  - double-clic pour revenir à 1 ;
  - la valeur passe par le slider de profondeur, masqué. L'état de l'interface, sauvé avec le
    patch et conservé à la recompilation, suit donc le réglage.
- **Câbles** : les câbles de modulation aboutissent au port, et déposer un câble sur un port ajoute
  une source.
- **Corrections associées** :
  - les profondeurs sont nommées d'après leur widget (`depth_<cible>`) et non plus par rang ;
    supprimer une modulation décalait les profondeurs des suivantes ;
  - la sauvegarde lit les valeurs de l'interface : `getParamValue` lit l'`AudioParam` du nœud
    AudioWorklet, qui ne suit pas une valeur fixée pendant que le contexte est suspendu (mesuré :
    elle restait à 1 après réglage à −0,4, alors que le son correspondait bien à −0,4).
- **Tests** : port du bon type ; géométrie (au centre, à la hauteur du widget, dans le module, sans
  chevauchement avec les ports audio) ; réglage de la profondeur au glisser, mesuré dans le son
  (0,75, puis 0,4 à −0,4, puis 0,75 après double-clic), sans changement de DSP ; profondeur sauvée.

### Évolution (2026-10-31, version 2.3.0) : ports audio en bas, ports de modulation sur le bord

À la demande de l'utilisateur, comme sur les synthés modulaires (Eurorack) : les entrées-sorties
audio passent sur le bord inférieur du module, ce qui libère le bord gauche pour les ports de
modulation.

- **Ports audio** (`ModuleView.setPorts`) : à cheval sur le bord inférieur ; entrées (vert) depuis
  la gauche, sorties (rouge) depuis la droite, séparées d'un écart de 16 px. Taille/pas : 30/36 px
  jusqu'à 4 ports par côté, 24/28 jusqu'à 8, 18/20 au-delà. Le module s'élargit pour les contenir
  (largeur minimale = somme des pas + marges), soit environ 2 × 32 × 20 = 1280 px au maximum de
  32 canaux par côté ; un padding bas réserve la demi-hauteur des ports.
- **Ports de modulation** : à cheval sur le bord gauche, à la hauteur du centre de leur widget ;
  la marge `has-modulations` est supprimée. Ils ne peuvent plus chevaucher les ports audio.
- **Câbles** (`PatchView.curve`) : courbes de Bézier orientées par port, tangente verticale vers
  le bas pour les ports audio, horizontale vers la gauche pour les ports de modulation ; la
  longueur des tangentes vaut max(40, d/2), d étant la distance des extrémités. Les câbles audio
  « pendent » donc entre les modules.
- **Réglage fin** : le glisser est incrémental, Δprofondeur = −Δy · r, avec r = 0,01 par pixel, ou
  0,001 avec Maj ; Maj peut être enfoncée ou relâchée en cours de geste sans saut de valeur. La
  valeur est arrondie à 10⁻³, et le slider de profondeur a un pas de 0,001 (auparavant 0,01, qui
  aurait quantifié le réglage fin).
- **Correction** : `recallAccValues` réécrivait `className` des contrôles au rappel d'un patch ; la
  classe `modulation-depth` disparaissait et les lignes de profondeur, masquées, réapparaissaient.
  Seules les classes de l'accéléromètre (`x`, `y`, `z`, `disabledAcc`) sont maintenant modifiées.
- **Tests (e2e)** : ports audio à moins de 2 px du bord inférieur, entrées dans la moitié gauche,
  sorties dans la moitié droite ; port de modulation centré sur le bord gauche ; avec Maj, 140 px
  vers le bas font passer la profondeur de 1 à 0,860, mesuré dans le son (0,5 + 0,86 · 0,25 =
  0,715) ; un geste mixte (20 px sans Maj puis 100 px avec) donne 0,560 ; lignes de profondeur
  masquées après rappel de l'exemple de modulation.

### Évolution (2026-10-31, version 2.7.0) : ± relatif à la position du slider

À la demande de l'utilisateur, après essai : le ± ajoutait D·m·(max − min)/2 autour du slider, puis
rognait aux bornes. Avec un slider proche d'une borne, la moitié de la course était perdue dans le
rognage, et la même modulation n'avait pas le même effet selon la position du slider.

- **Nouvelle règle** : la position du slider w est la position de repos. Avec u = D·m borné à
  [−1, 1] : u = 0 laisse w, u = 1 atteint le maximum, u = −1 le minimum, linéairement entre les deux :
  w + u·(max − w) si u ≥ 0, w + u·(w − min) si u < 0. La profondeur D règle la course autour de la
  valeur courante ; négative, elle inverse le sens.
- **Fréquences** (`[unit:Hz]`, `[scale:log]`, minimum > 0) : la même règle en octaves,
  w·(max/w)^u si u ≥ 0, w·(w/min)^u si u < 0. Un minimum ≤ 0 retombe sur la règle linéaire (le
  repli à 5 octaves de N disparaît, avec la fonction `octaves`).
- **Circuit Faust** : `(_, (*(D) : max(-1) : min(1)) : \(w, u).(w + u * select2(u < 0, max - w, w - min)) : clip)`,
  et `w * pow(select2(u < 0, max / w, w / min), u)` pour les fréquences.
- **Tests** : slider décentré (0,8 : +0,5 donne 0,9, −0,5 donne 0,4), profondeur 0,5 et −0,25,
  bornes atteintes à ±1, fréquences (440 Hz dans 20–20 000 : ±1 donne les bornes, +0,5 donne
  440·√(20 000/440)). En float32, la profondeur lissée par `si.smoo` se stabilise ~10⁻⁵ sous 1, erreur
  que l'exposant multiplie par ln(max/w) ≈ 3,8 : tolérance relative 3·10⁻⁴ (0,5 cent) pour les
  fréquences. Le test de bout en bout passe de 0,925 / 0,675 à 0,85 / 0,6 (slider à 0,8, m = 0,25,
  D = ±1).

### Évolution (2026-10-31, version 2.8.0) : un seul mode par sorte de widget

Avec le ± relatif à la position du slider (2.7.0), les deux autres modes s'obtiennent en plaçant le
slider : au minimum avec un signal unipolaire, le ± donne D·max·e, un VCA dont la profondeur règle le
niveau (« × doser ») ; au minimum avec D = 1, il parcourt toute la plage quand le signal va de 0 à 1
(« → piloter », pour des sources normalisées). D'où, à l'essai :

- **Un seul mode proposé** : ± pour les sliders, « piloter » pour les boutons et cases à cocher
  (`allowedModes`). La palette n'apparaît plus : relâcher le câble sur le widget suffit. Le code de la
  palette reste, pour le cas où plusieurs modes seraient de nouveau proposés.
- **Compatibilité** : « doser » et « piloter » sur un slider restent acceptés (`supportedModes`) ; les
  patchs qui les utilisent se chargent et sonnent comme avant.
- **Ce qui est perdu** : piloter un slider avec un signal brut (non normalisé, par exemple en hertz).
- **Tests** : dépôt direct sur un slider et sur un bouton, sans palette ; seconde source ajoutée à une
  modulation existante ; le test différentiel de l'export tire les modes parmi `supportedModes`, pour
  continuer à couvrir les trois circuits. Sa tolérance tient compte de la dérive de phase d'un
  oscillateur dont la fréquence est modulée : un écart d'un bit de poids faible sur la fréquence,
  intégré par l'oscillateur, donne 2,9·10⁻⁵ en fin de rendu (seuil 10⁻⁴ ; une erreur de sémantique
  donnerait des écarts de l'ordre de 0,1).

### Évolution (2026-11-01, version 2.9.0) : plus de palette, ports audio sur les côtés

- Le mode unique par sorte de widget est adopté après essai : la palette est supprimée (code,
  styles, chaînes), et le dépôt sur un widget le module directement.
- Les ports audio reviennent sur les côtés, dans une zone en bas du module sous le dernier widget
  (entrées à gauche, sorties à droite). Les ports de modulation gardent le bord gauche au-dessus,
  à la hauteur de leurs widgets : les deux ne peuvent plus se chevaucher.
- L'éditeur intégré est supprimé ; le crayon, dans la barre de titre, ouvre faustcode.

### Évolution (2026-11-01, version 3.9.0) : « + additionner » pour les curseurs de hauteur

La bibliothèque modulaire (`Documentation/MODULAR-LIBRARY.md`) fait de la modulation de widget l'unique
entrée de contrôle de ses modules : la hauteur d'un VCO est un curseur, et un séquenceur la pilote.
Le ± ne convient pas à une hauteur à 0.1 par octave : son excursion dépend de la position du slider
(w + u·(max − w) vers le haut, w + u·(w − min) vers le bas), si bien qu'une note n'est juste qu'avec
le slider au centre d'une plage symétrique et une profondeur de 1. D'où un quatrième mode, réservé
aux curseurs marqués `[unit:pitch]` :

| Choix | Formule | Rôle |
|---|---|---|
| **+ additionner** | borné(w + A · m), A de −1 à 1, 1 par défaut | le bouton et l'entrée 1 V/oct d'un oscillateur : le slider transpose, le signal est une hauteur ajoutée, juste quelle que soit la position du slider ; A dose le suivi (le suivi de clavier d'un filtre) |

- C'est le mode proposé pour ces curseurs (`allowedModes`) ; ±, × et ⇐ y restent acceptés.
- Le slider de quantité s'appelle `amount <cible>` (adresse `.../amount_<cible>`), marqué comme les
  profondeurs (`[modulation:<cible>]`) et réglé de même sur le port ; sa valeur est mémorisée quand la
  modulation est retirée, sauf si elle vaut sa valeur par défaut (1, contre 0.5 pour le ±).
- Ce n'est pas le « + » brut écarté plus haut : il ne s'applique qu'à des curseurs dont l'unité est
  celle du signal (0.1 par octave), ce qui rend l'addition exacte.

### Évolution (2026-11-02, version 3.11.0) : « ~ FM linéaire » et la métadonnée `[mod:...]`

Le ± d'un curseur de fréquence est exponentiel : il ne donne pas la FM classique (Chowning), où la
fréquence instantanée est fc + Δf·m(t) et l'indice I = Δf/fm. Trois défauts, mesurés pour un porteur à
440 Hz sur 20–20 000 Hz :

- la fréquence moyenne monte avec la profondeur (+33, +92 et +284 cents pour une excursion u = 0.05,
  0.1 et 0.2) : la note dérive quand l'indice change, et le spectre n'est plus celui de Bessel ;
- l'excursion dépend de la position du curseur et de ses bornes (0.55 octave vers le haut, 0.45 vers
  le bas pour u = 0.1) ;
- la fréquence est bornée au minimum du curseur, alors que la FM passe par zéro dès que Δf > fc.

D'où un cinquième mode, déclaré par le module avec la métadonnée `[mod:lin]` :

| Choix | Formule | Rôle |
|---|---|---|
| **~ FM linéaire** | w · (1 + D · m), borné à [−max, max] ; D de −10 à 10, 1 par défaut | la FM classique : avec un modulateur sinusoïdal de gain g à fm, I = D·g·fc/fm ; la fréquence moyenne reste fc ; la phase repart en arrière quand la fréquence devient négative (`os.osc` le permet : son accumulateur de phase en virgule fixe boucle dans les deux sens) |

- **`[mod:...]`** déclare le mode d'un curseur : `lin` (FM linéaire), `add` (équivalent de `[unit:pitch]`).
  Sans déclaration, le mode reste déduit de la sorte du widget.
- Le curseur de déviation s'appelle `deviation <cible>` (adresse `.../deviation_<cible>`), mémorisé
  comme les profondeurs ; sa plage de ±10 permet des indices de 5 à 10 (cloches, cuivres). Le glisser
  vertical sur le port couvre cette plage avec le même geste (0.1 par pixel, 0.01 avec Maj), et
  l'anneau montre |D|/10.
- Un indice constant sur tout le clavier : si porteur et modulateur suivent la même hauteur avec un
  rapport fixe, I = D·g·fc/fm ne change pas, comme sur un DX7.
