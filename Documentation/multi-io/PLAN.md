# FaustPlayground multi-entrées/sorties — état des lieux, difficultés, plan

Objectif : une nouvelle version de FaustPlayground où chaque module expose
**autant de ports que son DSP a d'entrées et de sorties** (un port par canal),
au lieu d'un unique port d'entrée et d'un unique port de sortie « stéréo ».

Base analysée : `master` @ `5a4f3fb` (version 1.7.1, faustwasm 0.19.2).
Toutes les mesures citées sont reproductibles avec les scripts de
[`probes/`](probes/) (à lancer depuis la racine du dépôt après `npm install`).

---

## 1. État des lieux

### 1.1 Architecture

~7 300 lignes de TypeScript, sans framework, sans tests, sans `tsconfig.json`
(Vite transpile sans vérifier les types). Fichiers concernés par le changement :

| Fichier | Rôle | Impact |
|---|---|---|
| `src/Modules/ModuleClass.ts` (466 l.) | contrôleur d'un module : DSP, UI, création des ports, recompilation | fort |
| `src/Modules/ModuleView.ts` (179 l.) | DOM du module ; **un** `fInputNode`, **un** `fOutputNode` | fort |
| `src/Modules/ModuleFaust.ts` | DSP + listes `fInputConnections` / `fOutputConnections` | fort |
| `src/Connect.ts` (185 l.) | connexion Web Audio + géométrie des câbles | à réécrire |
| `src/Dragging.ts` (414 l.) | glisser module / glisser câble (souris + tactile), hérité de Chris Wilson | à réécrire |
| `src/Scenes/SceneClass.ts` (709 l.) | scène, modules E/S physiques, sauvegarde/rappel JSON | fort |
| `src/EquivalentFaust.ts` (302 l.) | génération du code Faust équivalent pour l'export | à réécrire |
| `src/App.ts`, `src/Main.ts` | compilation, glisser-déposer de fichiers, `AudioContext` | moyen |
| `src/Menu/Save.ts`, `Load.ts`, `DriveAPI.ts` | stockage local, fichier, Google Drive (même JSON) | faible (format) |
| `css/Modules.css` | position des pastilles `.node-input` / `.node-output` | moyen |

Non concernés : accéléromètre, éditeur de mapping, menus, bibliothèque, messages.

### 1.2 Modèle de connexion actuel

- Un `Connector` relie **deux modules**, pas deux ports
  (`source: ModuleClass`, `destination: ModuleClass`). L'unicité est testée par
  paire de modules (`Dragging.ts:187`, `isConnectionUnique`), les auto-connexions
  sont interdites (`destination != sourceModule`).
- Côté audio : `sourceDSP.connect(destinationDSP)` (`Connect.ts:48`), c'est-à-dire
  un **bus de N canaux** d'une sortie Web Audio vers une entrée Web Audio.
  Un nœud faustwasm a 1 entrée Web Audio de `inputs` canaux et 1 sortie de
  `outputs` canaux, avec `channelCountMode: "explicit"`,
  `channelInterpretation: "speakers"` (faustwasm `FaustAudioWorkletNode`).
  L'adaptation du nombre de canaux est donc **implicite**, faite par les règles
  de mixage « speakers » de Web Audio : 1→2 duplique, 2→1 calcule ½(L+R),
  combinaisons non standard en mode « discrete » (troncature / zéros).
  Plusieurs sources vers une même entrée sont sommées.
- Déconnexion : `disconnect()` de **toutes** les sorties de la source puis
  reconnexion des autres (`Connect.ts:55-75`), contournement d'une ancienne
  limite de l'API.
- Création programmatique d'une connexion (rappel de patch, recompilation)
  en **simulant un glisser** (`Connect.createConnection` → `Drag.startDraggingConnection`
  / `stopDraggingConnection`) : la logique audio dépend du DOM et des `offsetLeft`.
- Géométrie : chaque câble mémorise ses extrémités (`x1,y1,x2,y2`) ;
  le redessin suppose une seule pastille par côté (`redrawInputConnections`).
- Détection de la cible au lâcher : boucle sur les modules + `isPointInInput`
  / `isPointInOutput` + cas particuliers par `id` DOM (`Dragging.ts:355-375`).
- L'état d'une connexion est réparti entre 4 endroits : `Connector`,
  les deux tableaux de `ModuleFaust`, l'élément SVG. Il n'y a pas de modèle de
  patch indépendant du DOM.

### 1.3 Modules d'entrée/sortie physiques

Ce sont des modules Faust compilés `process=_,_;` (`SceneClass.ts:130,139`).
L'entrée reçoit un `MediaStreamAudioSourceNode` (micro), la sortie est
connectée à `destination`, réglée en `discrete` avec
`channelCount = maxChannelCount` (`Main.ts:64-65`). Leur arité est donc figée
à 2×2, indépendamment du matériel.

### 1.4 Format de sauvegarde (v1)

Un objet `{ patchId: module }` ; chaque module stocke `inputs.source[]` et
`outputs.destination[]` (listes de `patchId`, avec `"input"` / `"output"` pour
les E/S physiques), sans indice de canal. Chaque connexion est donc stockée
deux fois (les doublons sont éliminés au rappel par `isConnectionUnique`).
Ce format existe dans : `public/json/*.json` (8 exemples), le `localStorage`
des utilisateurs, Google Drive, les fichiers `.json`/`.jfaust` échangés.
**La compatibilité ascendante est donc nécessaire.**

### 1.5 Export (code Faust équivalent)

`EquivalentFaust.getFaustEquivalent` :
1. connecte **réellement** (dans la scène vivante) tous les modules sans sortie
   au module de sortie (`EquivalentFaust.ts:169-177, 221`) ;
2. construit un **arbre** depuis la sortie en remontant les entrées ;
3. enveloppe chaque module par `stereoize(environment{…}.process)` et compose
   les entrées par `inputs :> module` ;
4. traite les cycles par un mécanisme ad hoc (`recursiveMap`, `~(_,_)`) qui
   suppose des cycles stéréo.

Le résultat est toujours stéréo (2 sorties) et le nom de groupe de chaque module
est son nom de fichier.

### 1.6 Mesures

**Arité réelle de la bibliothèque** (`probes/library-io.mjs`, 90 modules,
tous compilent) :

| Catégorie | in×out | nombre |
|---|---|---|
| generators | 0×1 | 37 |
| generators | 0×2 | 3 (SBird, SCMajDryHarp, SPentatonicDryHarp) |
| effects | 1×1 | 21 |
| effects | 2×2 | 2 (SLimiter, Volume) |
| effects | 2×1 | 1 (VibratoEnvelope — probablement involontaire) |
| combined | 0×1 | 5 |
| combined | 0×2 | 21 |

⇒ 93 % des générateurs sont mono et 88 % des effets sont 1×1. Aujourd'hui, ils
« sonnent » sur les deux haut-parleurs uniquement grâce au mixage implicite
1→2 de Web Audio. Avec un port par canal, ce comportement disparaît.

**Comportements Web Audio** (`probes/webaudio.cjs`, Chromium) :

| Test | Résultat |
|---|---|
| deux sources (1 et 2) sur la même entrée d'un `ChannelMergerNode` | 3 (somme exacte) |
| `src.disconnect(dest, output, input)` sélectif | fonctionne (canal 2 à 0) |
| cycle de nœuds **sans** `DelayNode` | le retour ne contribue pas (sortie 0,5 au lieu de converger vers 1) |
| cycle **avec** `DelayNode(0)` | retard effectif 128 échantillons (0,5 sur [0,127], 0,75 sur [128,255], …) |
| `ChannelMergerNode` / `ChannelSplitterNode` à 33 canaux | `IndexSizeError` (limite 32) |

**Faust** (`probes/export-scheme.mjs`, `probes/duplicate-ui.mjs`) :
- `route` somme les signaux dirigés vers une même sortie : `route(2,1,(1,1),(2,1))`
  appliqué à (1, 2) donne 3.
- Deux instances du même module enveloppées comme dans l'export actuel
  partagent **un seul** contrôle : une seule adresse `/Echo/gain` au lieu de deux.
- Le schéma d'export proposé en §4.4 (bus + `route` + `~`) est validé sur un
  graphe avec fan-out et rétroaction ; la sortie correspond à la valeur calculée
  à la main.

**Outillage** : `npm run build` passe. `tsc --strict` donne 391 erreurs ; avec
`strictPropertyInitialization` et `noImplicitAny` désactivés, il en reste 9.

### 1.7 Défauts existants relevés (indépendants du multi-canal)

| # | Défaut | Conséquence |
|---|---|---|
| D1 | Sémantiques **live** (mixage Web Audio) et **export** (`stereoize`) différentes | ex. générateur mono : live = signal identique sur L et R ; export `S(0,1) = p <: _/2,_/2` = −6 dB. Effet mono sur source stéréo : live = ½(L+R) traité une fois ; export = deux instances L et R |
| D2 | Deux instances d'un même module partagent leurs contrôles à l'export | mesuré (`duplicate-ui.mjs`) |
| D3 | L'export modifie la scène (connexions ajoutées vers la sortie) | effet de bord visible après export |
| D4 | Les cycles n'ont pas de rétroaction en live (pas de `DelayNode`) alors que l'export utilise `~` | D1 aggravé pour les patchs bouclés |
| D5 | `App.compileFaust` passe les paramètres par des champs `temp*` partagés, puis `await` | course probable si plusieurs fichiers sont déposés à la fois (positions/noms mélangés) |
| D6 | Positions sauvegardées via `getBoundingClientRect()` (coordonnées viewport) | décalage si la scène est défilée |
| D7 | Exemples `patch_big.json` et `patch_big_precompile.json` : 4 modules sur 10 (SAtonalSoftHarp, SBlowhistleBottle, SBouncyHarp, Granulator) importent `instrument.lib` ou `reduce.lib`, supprimées de Faust ; les factories de `patch_*_precompile.json` sont au format asm.js obsolète | exemples déjà inutilisables en 1.x (relevé en phase 1, `tests/model/v1.test.ts`) |
| D8 | `Scene.unstyleNode` ajoutait les modules d'E/S à la liste des modules de la scène à chaque fin de glisser tactile (`getModules()` renvoie la liste elle-même) ; `Scene.removeModule` supprimait le dernier module quand le module à retirer n'était pas dans la liste (`splice(-1, 1)`) | corrigés en phase 2 |

---

## 2. Difficultés techniques

Classées par risque décroissant.

### 2.1 Ergonomie : la disparition du mixage implicite (risque élevé)

Le public d'origine est constitué d'enfants. Aujourd'hui, un câble suffit pour
relier un générateur mono à la sortie stéréo. Avec un port par canal, il faut
2 câbles, sinon le son ne sort qu'à gauche. 37 des 40 générateurs sont concernés.
**Décision (§5.1) : la nouvelle version vise des utilisateurs avancés ; tous les
ports sont exposés et le câble unitaire est le geste principal.** Il faut tout de
même :
- une **connexion « bus »** (un seul geste qui crée plusieurs câbles), comme
  accélérateur secondaire, avec une règle d'adaptation explicite, déterministe et
  conforme à Faust. Elle sert aussi à convertir les patchs v1 (§2.8) ;
- un affichage lisible jusqu'à 32 ports (cibles tactiles d'environ 20 px minimum,
  numérotation, hauteur de module adaptative).

Règle d'adaptation proposée (« règle cyclique ») pour une sortie de n canaux et
une entrée de m canaux : pour k = 0 … max(n,m)−1, relier la sortie (k mod n) à
l'entrée (k mod m). Si m est un multiple de n, cela équivaut exactement à `<:` ;
si n est un multiple de m, à `:>`. La règle reste définie quand ni l'un ni
l'autre ne divise (3→2 : 0→0, 1→1, 2→0).

### 2.2 Équivalence live ⇄ export (risque élevé)

Il faut **une seule sémantique**, la même pour le moteur Web Audio et pour le
code Faust exporté :
- un câble = un signal mono, gain 1 ;
- une entrée = somme de ses câbles (0 si aucun) ;
- une sortie peut alimenter plusieurs câbles (fan-out, **une seule instance**) ;
- les cycles sont autorisés, avec un retard sur les arcs de rétroaction.

Seule divergence inévitable : le retard de rétroaction vaut 128 échantillons en
Web Audio (mesuré, quantum de rendu) contre 1 échantillon pour `~` en Faust.
**Décision (§5.3) : l'écart est accepté et documenté** ; l'export conserve la
sémantique naturelle de `~`, sans `@(127)`.
Le choix des arcs retardés doit être **le même** des deux côtés : on prend les
arcs arrière d'un parcours en profondeur dans un ordre déterministe.

### 2.3 Génération du Faust équivalent pour un graphe quelconque (risque moyen)

L'algorithme actuel (arbre + `stereoize`) ne se généralise pas : il duplique les
sous-graphes partagés, suppose la stéréo et traite mal les cycles. Il faut
compiler un **graphe orienté quelconque avec ports** vers une expression de
diagrammes de blocs. Solution validée (§4.4) : bus de signaux croissant, une
étape `route : module` par module en ordre topologique, `~` global sur les arcs
de retour. Points à surveiller : la largeur du bus (O(Σ sorties)) et le temps de
compilation sur de gros patchs. Une optimisation par durée de vie des signaux
est possible si nécessaire.

### 2.4 Routage par canal en Web Audio (risque faible, maîtrisé)

Un nœud faustwasm n'expose qu'un port Web Audio multicanal. Deux options :
- **(A) recommandée** : `ChannelMergerNode(nIn)` → nœud Faust →
  `ChannelSplitterNode(nOut)` par module ; un câble i→j devient
  `splitter.connect(merger, i, j)`, et sa suppression
  `splitter.disconnect(merger, i, j)`. Toutes les propriétés nécessaires ont été
  vérifiées (somme, déconnexion sélective). Aucun changement dans faustwasm.
- (B) modifier faustwasm pour créer `numberOfInputs = nIn` ports mono. Cette
  option économise deux nœuds par module, mais demande une modification
  amont et ne couvre pas le repli `ScriptProcessorNode`.

Limite : **32 canaux** par port (merger/splitter, `channelCount` de
l'AudioWorklet). **Décision (§5.6) : limite acceptée.** Un module à plus de
32 entrées ou 32 sorties est refusé avec un message explicite ; (B) n'est pas
retenu.

### 2.5 Cycles en Web Audio (risque moyen)

Un cycle sans `DelayNode` ne réinjecte rien (mesuré). Il faut insérer un
`DelayNode` sur chaque arc de retour et **recalculer l'ensemble des arcs de
retour à chaque modification du graphe** : l'ajout d'un câble peut transformer
un arc avant en arc de retour. Il faut aussi recâbler uniquement les arcs dont
le statut change, pour éviter les clics.

### 2.6 Recompilation avec changement d'arité (risque moyen)

Éditer le code d'un module peut changer son nombre d'entrées et de sorties. Il
faut conserver les câbles dont les indices restent valides, supprimer les autres
et le signaler. Aujourd'hui, `updateDSP` (`ModuleClass.ts:205-245`) reconstruit
les connexions en simulant des glisser, ce qui ne transpose pas.

### 2.7 Interaction : réécriture du glisser de câbles (risque moyen, volume important)

`Dragging.ts` gère séparément la souris et le tactile (multi-touch via
`dragList`). Il s'appuie sur les classes CSS et `offsetParent`, et contient des
cas particuliers pour les modules E/S. Plutôt que de l'adapter, on peut le
réécrire avec les **Pointer Events** (souris, tactile et stylet unifiés,
`setPointerCapture`). Le test de cible se ferait par `elementFromPoint` et des
attributs `data-module` / `data-port` / `data-dir`. La géométrie des câbles
serait recalculée à partir des ports au lieu d'être mémorisée.

### 2.8 Migration des patchs v1 (risque moyen)

La conversion d'une connexion v1 A→B en câbles se fait avec la règle cyclique.
Les seules arités rencontrées en pratique (§1.6) sont 1→1, 1→2, 2→1 et 2→2.
La règle cyclique reproduit exactement le comportement live v1, **sauf en 2→1** :
v1 donnait ½(L+R), la règle donne L+R, soit **+6 dB**. Ce cas est fréquent
(21 « combined » stéréo vers des effets mono). **Décision (§5.2) : somme
simple, sans gain par câble.** Les patchs v1 concernés sonneront 6 dB plus fort ;
cette conséquence sera signalée dans les notes de version.

Les connexions v1 doivent être créées **après** la compilation de tous les
modules, car les arités ne sont connues qu'à ce moment-là. L'ordre actuel le
permet déjà, sauf pour les patchs précompilés où l'arité est lisible dans
`factory.json`.

### 2.9 E/S physiques à arité variable (risque faible)

- Sortie : `destination.maxChannelCount` (2 sur la plupart des machines, plus
  avec une carte multicanal), via un merger natif. Le module Faust `process=_,_`
  devient inutile.
- Entrée : nombre de canaux du `MediaStreamTrack` (contrainte `channelCount`),
  via un splitter natif. Ce nombre n'est connu qu'après `getUserMedia` (et après
  l'autorisation, voire jamais si elle est refusée). Le module d'entrée doit donc
  pouvoir changer d'arité après coup (§2.6).
- Export : une application exportée vers Android ou d'autres plateformes aura
  E_in entrées et E_out sorties. **Décision (§5.5) : arité native par défaut,
  avec une option « forcer la stéréo »** qui adapte les E/S externes par la
  règle cyclique.

### 2.10 Dette technique transverse (risque faible, mais coût réel)

- État global (`Utilitary.currentScene`, `recursiveMap`, `idX`) et nœuds audio
  stockés sur des `div` du DOM (`document.getElementById("audioOutput").audioNode`).
- Passage de paramètres par champs `temp*` (D5).
- Pas de vérification de types ni de tests. Or un changement de cette ampleur a
  besoin de tests sur le modèle et l'export.

---

## 3. Choix d'architecture proposés

1. **Modèle de patch pur** (`src/model/`), sans DOM ni Web Audio, seule source
   de vérité :
   ```ts
   type PortRef = { module: ModuleId; port: number };
   interface Connection { id: ConnId; from: PortRef /* sortie */; to: PortRef /* entrée */ }
   interface ModuleSpec { id; kind: "faust" | "input" | "output"; name; code;
                          x; y; numInputs; numOutputs; params; acc }
   class Patch {           // invariants vérifiés ici, événements émis
     addModule / removeModule (cascade) / setArity (élagage)
     connect(from, to) / disconnect(id) / connectBus(a, b)  // règle cyclique
     feedbackEdges(): Set<ConnId>                           // arcs arrière DFS déterministe
   }
   ```
2. Trois **observateurs** du modèle :
   - `AudioGraph` : merger, nœud Faust et splitter par module, `DelayNode` sur
     les arcs de retour ;
   - `PatchView` : modules, ports, câbles SVG, Pointer Events ;
   - `FaustExporter` : fonction pure `Patch → string`.
3. Sérialisation **v2** (`{ version: 2, sceneName, modules: [...], connections: [...] }`)
   et un **lecteur v1** qui convertit vers le modèle (§2.8).
4. Interface (utilisateurs avancés, §5.1) :
   - tous les ports visibles et numérotés ;
   - glisser depuis un port pour un câble unitaire (geste principal) ;
   - accélérateur secondaire : lâcher un câble sur le corps du module cible
     (et non sur un port) crée une connexion bus selon la règle cyclique ;
   - clic sur un câble pour le supprimer (comme aujourd'hui).
5. Outillage : `tsconfig.json` (non strict au départ), `tsc --noEmit` et
   **Vitest** en CI. Tests unitaires pour le modèle, la migration et l'export
   (libfaust sous Node, comme dans `probes/`). Un **test différentiel
   live/export** dans Chromium (Playwright) : rendu `OfflineAudioContext` du
   graphe Web Audio comparé au rendu Faust du code exporté, sur des graphes
   acycliques.

---

## 4. Plan

Chaque phase laisse l'application dans un état fonctionnel, livrable sur la
branche de travail.

### Phase 0 — Socle (≈ 0,5 j)
- `tsconfig.json`, script `npm run typecheck`, correction des 9 erreurs
  restantes en mode non strict ; Vitest et `npm test` ; étape CI dans
  `.github/workflows/main.yml`.
- Les `probes/` deviennent les premiers tests.

**Validation** : CI verte, build inchangé.

**État : fait.** `tsconfig.json` (strict, sauf `noImplicitAny` et
`strictPropertyInitialization`) et `tests/tsconfig.json` ; `npm run typecheck`,
`npm test` (Vitest 5, libfaust sous Node) ; workflow `.github/workflows/ci.yml`
(vérification des types, tests, build). Tests initiaux : sémantique Faust utilisée
par l'export (`tests/faust/semantics.test.ts`) ; compilation des 90 modules de la
bibliothèque avec instantané de leurs arités (`tests/library/modules.test.ts`).
La mesure Web Audio reste un script (`probes/webaudio.cjs`), en attendant les
tests navigateur de la phase 2.

### Phase 1 — Modèle et format (≈ 2 j)
- `Patch` (§3.1), règle cyclique, arcs de retour déterministes.
- Sérialisation v2 et lecteur v1, avec tests sur les 8 exemples de
  `public/json/`. On vérifie que la conversion v1→v2 conserve modules, positions
  et paramètres, et que la règle cyclique produit les câbles attendus selon
  l'arité.

**Validation** : tests unitaires ; aucune modification visible.

**État : fait.** Trois fichiers sans DOM ni Web Audio, sous `src/model/` :
- `Patch.ts` : modules à ports numérotés (au plus 32 de chaque côté), connexions
  port à port, événements pour les observateurs, `connectBus` (règle cyclique
  `busPairs`), `setArity` (élagage des câbles devenus invalides) et `analyze()`.
  Cette dernière renvoie les arcs de rétroaction (arcs arrière d'un DFS
  déterministe, partant des modules sans entrée) et un ordre topologique du
  graphe privé de ces arcs. Le module `input` n'a que des sorties et `output`
  que des entrées.
- `PatchFormat.ts` : format v2 (`format`, `version`, `modules`, `connections`)
  et lecture validée qui localise les erreurs (`modules[2].code: string expected`).
- `PatchFormatV1.ts` : lecture tolérante du v1 (nombres en chaînes, champs
  absents, factories asm.js ignorées), puis migration une fois les arités
  connues. Chaque lien v1 devient une connexion bus ; les modules d'arité
  inconnue (non compilables) sont écartés avec un avertissement.

Tests (`tests/model/`, 49 tests) : invariants du modèle ; règle cyclique comparée
à `<:` et `:>` ; arcs de rétroaction sur 200 graphes aléatoires (le graphe privé
de ces arcs est acyclique et ordonné par `order`) ; indépendance vis-à-vis de
l'ordre de création des câbles ; aller-retour v2 ; messages d'erreur ; migration
des 8 exemples, avec arités obtenues par compilation libfaust et comparées à
celles des factories précompilées.

### Phase 2 — Moteur audio multicanal (≈ 2–3 j)
- `AudioGraph` piloté par le modèle (merger/splitter, `disconnect` sélectif,
  `DelayNode` sur les arcs de retour, recâblage incrémental).
- E/S physiques natives à arité matérielle (suppression des deux compilations
  `process=_,_` au démarrage).
- Branchement transitoire : l'interface actuelle à un port appelle
  `connectBus` ; l'application fonctionne déjà sur le nouveau moteur, sans
  changement visuel. La régression +6 dB en 2→1 apparaît ici (§2.8).
- `ModuleClass` / `Scene` délèguent au modèle ; suppression de
  `Connect.connectModules/disconnectModules` et des champs `temp*` (D5).

**Validation** : patchs d'exemple écoutés, test Playwright du graphe
(rendu hors ligne de patchs simples).

**État : fait.**
- `src/audio/AudioGraph.ts` observe le patch. Pour chaque module, il place
  `ChannelMergerNode(nIn) → nœud → ChannelSplitterNode(nOut)` ; le nœud est le
  DSP Faust, la source micro ou la destination. Chaque connexion devient un lien
  mono splitter[i] → merger[j]. Les connexions de rétroaction passent par un
  `DelayNode`. Le câblage est recalculé par réconciliation après chaque
  modification du patch, ce qui couvre aussi le cas où une connexion se met à
  fermer un cycle et doit recevoir le retard.
- E/S physiques sans compilation Faust :
  - la sortie a `destination.maxChannelCount` entrées (au plus 32) ;
  - l'entrée est stéréo jusqu'à l'autorisation du micro, puis prend le nombre de
    canaux de la piste ; les connecteurs déjà tracés depuis l'entrée sont alors
    complétés selon la règle cyclique.
- `Scene` possède le `Patch` et l'`AudioGraph`. Chaque `ModuleClass` est lié à un
  module du patch par `moduleId`. Chaque `Connector` (le trait unique de la vue
  actuelle) garde la liste des connexions du patch qu'il représente : à sa
  création, une connexion bus ; à sa suppression, ces connexions sont retirées.
  La recompilation d'un module met à jour son nombre de ports (`setArity`) et
  son nœud, puis recrée les connecteurs avec le nouveau bus.
- Sauvegarde au format v2 : positions lues dans `style.left/top` (corrige D6),
  noms, code, paramètres, accéléromètre, factories si « précompilé ».
  Chargement v1 et v2, ajouté à la scène existante, avec renumérotation des
  modules. Les modules impossibles à créer et les connexions invalides (port
  absent sur cette machine, par exemple) sont écartés, avec un message qui les
  liste.
- `App.compileFaust` n'utilise plus de champs `temp*` et ne dépend plus de `this`
  (corrige D5) ; `Scene` n'a plus de champs `temp*`.
- Corrigés au passage : D8.
- Non modifié : l'export (`EquivalentFaust`, phase 4). Il lit toujours les
  `Connector` et reste stéréo ; son effet de bord D3 crée maintenant des
  connexions bus dans le patch.

Tests : `tests/browser/audiograph.test.ts` (6 tests, vrais nœuds faustwasm dans
un `OfflineAudioContext`) vérifie le routage par canal, la somme des entrées,
le partage d'une sortie, le silence des entrées non connectées, la
déconnexion, la rétroaction (0,5 puis 0,75 à partir de l'échantillon 128, puis
0,875), le déplacement du retard, le changement de ports et la suppression d'un
module. `tests/e2e/app.test.ts` (6 tests, application servie par Vite et pilotée
par Playwright) couvre le démarrage, le chargement v1 avec son mesuré en
sortie, l'aller-retour v2 avec factories précompilées, l'exemple aux modules
cassés, la suppression d'un connecteur par clic et sa recréation à la souris,
la recompilation avec changement de ports et la suppression d'un module.

### Phase 3 — Interface multi-ports (≈ 4–5 j, la plus longue)
- `ModuleView` : colonnes de ports, hauteur adaptative, numéros, état
  mini/maxi.
- Réécriture du glisser (module et câble) en Pointer Events, cibles par
  attributs `data-*` ; suppression de `Dragging.ts` / `Connect.ts`.
- Câbles par port avec géométrie recalculée ; connexion bus (lâcher sur le
  corps du module) ; surlignage des cibles compatibles.
- Recompilation avec changement d'arité (§2.6) et message à l'utilisateur.
- Vérification tactile (tablette) et en multi-touch.

**Validation** : scénarios manuels + tests Playwright (création, connexion,
suppression, sauvegarde/rappel).

### Phase 4 — Export Faust v2 (≈ 2 j)
- `FaustExporter` pur, sans effet de bord sur la scène (corrige D3) :
  1. bus initial = [sources des arcs de retour (F) | entrées physiques] ;
  2. pour chaque module, dans l'ordre topologique sans les arcs de retour :
     `étape_k = si.bus(w) <: si.bus(w), (route(w, in_k, …) : M_k)`, puis
     w += out_k ;
  3. `route` final vers [F | sorties physiques] ;
  4. `process = cœur ~ si.bus(|F|) : (si.block(|F|), si.bus(E_out))` ;
  5. `M_k = vgroup("Nom#k", environment{code}.process)`, avec des étiquettes
     uniques (corrige D2).

  Exemple validé : `probes/export-scheme.mjs`.
- Modules sans chemin vers une sortie physique : ignorés (§5.4).
- Option « forcer la stéréo » à l'export (§5.5).
- Refus explicite des modules à plus de 32 entrées ou sorties (§5.6).
- Tests : compilation de l'export de chaque exemple et arités attendues ; test
  différentiel live/export (≤ 1e-6 sur graphes acycliques) ; sur les graphes
  bouclés, test de l'export seul (retard de 1 échantillon, §5.3).

### Phase 5 — Finitions (≈ 1–2 j)
- Migration des exemples `public/json/` en v2 (le lecteur v1 reste).
- Éventuelle correction de `VibratoEnvelope` (2×1).
- Ajout à la bibliothèque de modules réellement multicanaux (spatialisation,
  matrices, ambisonie) pour démontrer la fonctionnalité.
- Documentation (README, `Documentation/`), version 2.0.0.

**Estimation totale : 12 à 15 jours de développement.**

---

## 5. Décisions (arrêtées le 2026-10-30)

| # | Question | Décision |
|---|---|---|
| 1 | Public visé | **Utilisateurs avancés** : tous les ports exposés, câble unitaire comme geste principal ; connexion bus en accélérateur secondaire |
| 2 | Fusion n→m (n > m) | **Somme simple**, conforme à `:>` ; pas de gain par câble ; +6 dB en 2→1 pour les patchs v1, signalé dans les notes de version |
| 3 | Retard de rétroaction | **Écart accepté** : 128 échantillons en live, 1 échantillon (`~`) à l'export ; documenté |
| 4 | Modules non connectés à l'export | **Ignorés** (cohérent avec le live, où ils sont muets) |
| 5 | Arité de l'export | **Arité native** du patch par défaut, **option « forcer la stéréo »** (règle cyclique sur les E/S externes) |
| 6 | Limite de canaux | **32 entrées et 32 sorties** par module au maximum ; au-delà, refus avec message ; pas de modification de faustwasm |
