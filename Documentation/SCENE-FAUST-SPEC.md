---
title: Une scène, un programme Faust
subtitle: Compresser une scène en un programme, décompresser un programme en une scène, et revenir au point de départ
author: Yann Orlarey
organization: EMERAUDE (GRAME/INRIA/INSA)
date: 7 novembre 2026
document-style: article-a4
language: fr
---

::: toc+
- **Objet** — deux transformations, et ce que « presque l'identité » veut dire.
- **Ce qui existe** — l'export de faustmodular, la sémantique d'une scène, la grammaire de Faust.
- **La thèse** — un programme canonique, un manifeste, et un décompresseur qui lit le câblage.
- **Compresser** — le programme canonique produit par une scène.
- **Décompresser** — trois niveaux : exact, annoté, structurel.
- **Le câblage d'une expression** — des opérateurs de composition à un graphe de modules.
- **Les programmes écrits à la main** — feuilles, granularité, code des modules, disposition.
- **Les écarts de sémantique** — retard des rebouclages, choix du câble retardé, sommes.
- **Critères** — les deux allers-retours, et comment les tester.
- **Surfaces** — dans faustmodular, dans faustcode, dans les magasins.
- **Décisions et points ouverts**, **Phases**.
:::

# Objet \label{sec:objet}

Deux transformations :

- **compresser** : une scène de faustmodular devient **un seul programme Faust**, qui calcule les mêmes signaux ;
- **décompresser** : un programme Faust devient **une scène** : des modules et des câbles.

Leur enchaînement doit être **presque l'identité**, dans les deux sens. Cela se définit par deux critères différents :

1. **Scène → programme → scène** redonne **la même scène** : mêmes modules, avec le même code (même empreinte SHA-1), mêmes câbles, mêmes réglages (valeurs des paramètres, modulations, accéléromètres, interface Orbit), mêmes positions. C'est une égalité structurelle, à l'ordre et aux identifiants près, vérifiable exactement (\ref{sec:criteres}).
2. **Programme → scène → programme** redonne **un programme qui calcule les mêmes signaux**, pas le même texte. C'est une équivalence sémantique, vérifiable par le rendu (\ref{sec:criteres}).

Ce qu'on y gagne :
- une scène se lit, se partage, se compile pour d'autres cibles (plugin, application, embarqué), et s'édite dans faustcode comme un programme ;
- un programme écrit à la main se manipule comme une scène, on y insère un module, on le recâble ;
- une scène peut **jouer compilée** : un seul nœud audio, des rebouclages à un échantillon et moins de calcul (\ref{sec:ecarts}).

# Ce qui existe \label{sec:existant}

**L'export** (`src/export/FaustExporter.ts`) compresse déjà une scène. Les modules, dans l'ordre topologique, calculent un bus qui grandit :

```
bus = [ signaux rebouclés (F) | entrées physiques | sorties des modules déjà calculés ]
stage_k = si.bus(w) <: si.bus(w), (route(w, in_k, paires) : M_k)
process = (stage_1 : … : stage_n : route(…)) ~ si.bus(F) : (si.block(F), si.bus(sorties))
```

Chaque module est une définition `fp_moduleK = environment{ <code effectif> }.process`. Le code effectif est le code du module, augmenté de ses modulations (`modulatedCode`, `src/model/Modulation.ts`). Celui-ci garde le code d'origine **intact** à l'intérieur : `route(…) : [ "cible" : circuit, … -> environment{ <code> }.process ]`. Les modules qui n'atteignent pas la sortie sont **retirés**. Le programme est juste, mais sa structure se perd dans les `route`, et rien ne dit où étaient les modules, ni les valeurs de leurs réglages.

**La sémantique d'une scène** (`src/model/Patch.ts`) :
- un câble porte un signal mono, de gain 1 ;
- une entrée reçoit la **somme** de ses câbles, ou le silence ;
- une sortie alimente autant de câbles qu'on veut ;
- les cycles sont permis : `analyze()` choisit les câbles retardés (`feedback`) ;
- un module a ses entrées audio, puis une entrée par modulation ;
- le code d'un module est enveloppé : `process = vgroup("<Nom>",environment{ … }.process);` (`src/model/ModuleCode.ts`).

**La grammaire de Faust** (`compiler/parser/faustparser.y`) fixe les précédences, de la plus faible à la plus forte : `with`, `letrec` ; `<:` et `:>` (à droite) ; `:` (à droite) ; `,` (à droite) ; `~` (à gauche) ; les comparaisons ; `+ - |` ; `* / % & xor << >>` ; `^` ; `@` ; `'` ; `.`. L'opérateur `<:` répète les sorties de façon cyclique (l'entrée k de droite reçoit la sortie k mod n de gauche), et `:>` somme de façon cyclique. C'est la règle des bus de faustmodular (`busPairs`). Une chaîne littérale ne contient pas de guillemet (`"[^"]*"`). `declare clé "valeur";` et `declare f clé "valeur";` donnent des métadonnées globales et par définition.

# La thèse \label{sec:these}

> Un **programme canonique** porte la scène : un module par définition, son code intact, le câblage en Faust, et un **manifeste** pour ce qui n'est pas du son. Le **décompresseur lit le câblage** d'une expression Faust, quelle qu'elle soit. Le manifeste ne fait qu'annoter ce qu'il a trouvé.

Trois conséquences :

- **Exact quand rien n'a changé** : le manifeste suffit à refaire la scène.
- **Robuste aux modifications** : un programme compressé, puis modifié dans faustcode, se décompresse encore. Le câblage est relu dans le texte, et le manifeste rend ce qu'il peut (positions, réglages) aux modules qu'on reconnaît.
- **Ouvert aux programmes écrits à la main** : le même lecteur de câblage les décompose, sans manifeste.

# Compresser \label{sec:compresser}

Le programme canonique est la sortie de l'export actuel, avec trois changements.

1. **Tous les modules sont gardés**, même ceux qui n'atteignent pas la sortie. Le compilateur ne calcule que ce qui mène aux sorties : cela ne coûte rien au son, et la scène revient entière.
2. **Chaque définition porte l'identifiant de son module** : `fp_module<id>`, au lieu du rang. Les modules de même nom gardent leurs groupes distincts.
3. **Un manifeste** est ajouté en fin de fichier, dans un commentaire :

```faust "Le manifeste d'un programme canonique"
/* faustmodular-scene
{
  "format": "faustmodular-faust", "version": 1,
  "scene": "Vibrato",
  "io": { "input": { "x": 10, "y": 425 }, "output": { "x": 1302, "y": 425 } },
  "modules": {
    "fp_module2": { "id": "2", "name": "SOscillator", "code": "3f1c…",
                    "x": 480, "y": 120, "params": { "/SOscillator/Frequency": 300 },
                    "acc": [], "modulations": [ … ], "view": { … } }
  },
  "connections": [ "3:0>2:1", "2:0>output:0" ],
  "feedback": [ "4:0>3:0" ],
  "check": "<SHA-1 du programme sans ce commentaire>"
}
*/
```

- **Un commentaire plutôt qu'un `declare`.** Une chaîne de Faust ne peut pas contenir de guillemet, et le JSON en a partout. Le commentaire se lit, se cherche et s'édite à la main, et le compilateur l'ignore. Le décompresseur lit le texte, pas le programme compilé.
- **`code`** : l'empreinte du code du module (sans enveloppe), celle du magasin de codes et des magasins. Le code lui-même est dans la définition, une seule fois.
- **`params`** : les valeurs courantes, par adresse relative au module. Le code n'est pas réécrit : les valeurs initiales des widgets restent celles du code, ce qui garde l'empreinte.
- **`feedback`** : les câbles retardés, ceux que `~` retarde dans le programme (\ref{sec:ecarts}).
- **`check`** : l'empreinte du texte qui précède le manifeste. Elle dit si le programme a été modifié depuis sa compression.

L'export vers les cibles du service de compilation garde son en-tête et peut omettre le manifeste. Le programme reste le même.

# Décompresser \label{sec:decompresser}

| Niveau | Quand | Résultat |
| :-- | :-- | :-- |
| **A. Exact** | manifeste présent, `check` juste | la scène du manifeste, les codes lus dans les définitions |
| **B. Annoté** | manifeste présent, `check` faux (le programme a été modifié) | le câblage relu dans le texte (\ref{sec:cablage}) ; chaque module reconnu par son identifiant `fp_module<id>` reprend du manifeste sa position, ses réglages encore valides (adresses qui existent toujours) et ses modulations ; un module nouveau est placé (\ref{sec:main}) |
| **C. Structurel** | pas de manifeste | le câblage relu dans le texte, les modules placés |

- **Le code d'un module** est relu dans sa définition :
  - `environment{ X }.process`, éventuellement dans un `vgroup` : X est le code du module, enveloppe comprise ;
  - s'il a la forme produite par `modulatedCode` (`route(…) : [ … -> environment{ C }.process ]`), C est le code d'origine, et chaque cible avec son circuit redonne une modulation. Le circuit est reconnu en le comparant au texte que `circuit(spec)` produit pour chaque mode, avec les bornes lues dans le texte. Un circuit non reconnu laisse au module le code effectif, sans modulation.
- **Les entrées réservées** d'un module synchronisé (`(par(i, p, _), par(i, r, 0)) : …`, `src/sync/SyncInputs.ts`) sont reconnues et retirées : le module retrouve sa ligne de temps commune.
- **Un code relu dont l'empreinte diffère du manifeste** est une nouvelle version du module (règle du statut de `DOCUMENT-SPEC.md`). Le module garde sa position et ses réglages.

# Le câblage d'une expression \label{sec:cablage}

Le décompresseur lit l'expression de `process` (et, en descendant, celle des définitions, \ref{sec:main}) avec les précédences de Faust. Il en tire un graphe par une interprétation **compositionnelle** : chaque sous-expression est un bloc, avec une liste de **nœuds** d'entrée et une liste de nœuds de sortie. Un nœud est un point du circuit. Il a un ensemble de **sources** (des sorties de modules, ou une entrée physique) dont il porte la **somme**, et un ensemble de **puits** (des entrées de modules, ou une sortie physique). C'est exactement la sémantique d'une entrée de module, qui somme ses câbles.

| Expression | Bloc |
| :-- | :-- |
| feuille M (n entrées, m sorties) | entrées : n nœuds, le k-ième a pour puits (M, k) ; sorties : m nœuds, le k-ième a pour source (M, k) |
| `_` | un nœud, à la fois entrée et sortie |
| `!` | un nœud d'entrée, sans sortie |
| `0` | un nœud de sortie sans source (le silence) |
| `si.bus(n)`, `par(i, n, _)` | n fois `_` |
| `si.block(n)` | n fois `!` |
| `route(n, m, (a,b)…)` | n nœuds d'entrée ; la sortie b est **unifiée** avec chaque entrée a qui la vise, et une sortie visée par aucune est le silence |
| `A : B` | la sortie k de A unifiée avec l'entrée k de B (même nombre, sinon erreur, comme Faust) |
| `A , B` | les entrées puis les sorties de A et de B, mises bout à bout |
| `A <: B` | l'entrée k de B unifiée avec la sortie k mod n de A |
| `A :> B` | les sorties de A rangées par k mod m, chaque groupe unifié avec l'entrée k de B (une somme) |
| `A ~ B` | la sortie k de A unifiée avec l'entrée k de B ; la sortie k de B unifiée avec l'entrée k de A, **par un câble retardé** ; le bloc garde les autres entrées de A et toutes ses sorties |
| `A + B` | `(A, B) :> _` : une somme, sans module |
| `A ⊕ k`, `k ⊕ A` (⊕ un autre opérateur infixe, k une constante) | `A : ⊕(k)`, ou `A : (k, _ : ⊕)` : une feuille `⊕(k)`, comme on l'écrirait en Faust |

- **Unifier deux nœuds** les fusionne : leurs sources et leurs puits sont réunis (*union-find*). Un nœud qui a plusieurs sources porte leur somme, et chacun de ses puits la reçoit. C'est la sémantique de la scène, et celle de `_`, `<:` et `:>` en Faust.
- **À la fin** :
  - les entrées du bloc de `process` sont les entrées physiques (des sources) ;
  - ses sorties sont les sorties physiques (des puits) ;
  - chaque nœud donne un câble de chacune de ses sources vers chacun de ses puits ;
  - un nœud sans source laisse ses puits silencieux ;
  - un nœud sans puits est perdu, comme `!`.
- **Le nombre d'entrées et de sorties d'une feuille** est demandé au compilateur. faustmodular compile déjà chaque module pour le placer, et le nombre vient de sa factory.
- **Le programme de l'export se relit ainsi tel quel** : `si.bus`, `route`, `si.block`, `<:` et `~` ne sont que du câblage. Le décompresseur est donc un inverse à gauche de l'export pour le câblage, sans manifeste. C'est la base du niveau A comme du niveau C.

# Les programmes écrits à la main \label{sec:main}

**Les feuilles.** On descend dans l'expression jusqu'à une feuille, qui devient un module :
- un appel d'une bibliothèque (`os.osc(440)`, `fi.lowpass(2, 1000)`) ;
- un appel d'une fonction à paramètres (`voice(3)`) ;
- une primitive autre que `+` (`*(0.5)`, `@(100)`, `mem`) ;
- une constante autre que 0 ;
- un widget ;
- une expression qui n'est pas une composition (`par`, `seq`, `sum`, `prod`, un motif, une `environment`).

On ne s'arrête pas sur `_`, `!`, `+`, `0` et le câblage du tableau, qui deviennent des câbles. Un opérateur infixe autre que `+` dont un opérande est une constante devient sa forme partielle (`A * 10` → `A : *(10)`), une seule feuille.

**La granularité** est un réglage, de 0 à ∞ :
- **0** : tout le programme est un seul module ;
- **1** : on décompose l'expression de `process` ;
- **chaque niveau de plus** : on remplace un identifiant **défini dans le fichier, sans paramètre**, par l'expression qui le définit, s'il s'agit d'une composition.

On ne remplace jamais un identifiant d'une bibliothèque. Par défaut on décompose tout ce que le fichier définit, ce qui suit l'intention de l'auteur : il a nommé ses étages.

**Le code d'un module** est :
- les `import` et les définitions du fichier dont la feuille dépend (fermeture par les identifiants qu'elles citent) ;
- puis `process = <feuille>;`, enveloppé par faustmodular.

Une feuille prise dans un `with { … }` emporte ce bloc : `process = <feuille> with { … };`. Le nom du module est celui de la feuille, réduit à un identifiant (`fi.lowpass(2, 1000)` → `lowpass`). Les noms en double reçoivent un numéro.

**La disposition** : les modules sont placés en colonnes par profondeur depuis les entrées (un rangement en couches), les rebouclages allant vers la gauche, puis dans chaque colonne dans l'ordre de l'expression. On peut la retoucher à la main, et le niveau B la conservera.

**Exemple.**

```faust
import("stdfaust.lib");
vibrato = os.osc(5) * 10 + 440 : os.osc;
process = vibrato : fi.lowpass(2, 2000) <: _, _;
```

Avec la granularité par défaut :
- `vibrato` est remplacé par sa composition ;
- les feuilles sont `os.osc(5)`, `*(10)`, `440`, `os.osc` et `fi.lowpass(2, 2000)` ;
- `+` est une somme : `440` et `*(10)` alimentent ensemble l'entrée de `os.osc` ;
- `<: _, _` envoie la sortie du filtre vers les deux sorties physiques.

La scène a 5 modules et 6 câbles ; recompressée, elle calcule les mêmes signaux.

# Les écarts de sémantique \label{sec:ecarts}

- **Le retard des rebouclages.** En direct, un câble retardé passe par un `DelayNode`, qui retarde d'un bloc de rendu (128 échantillons). `~` retarde d'un échantillon. Une scène qui reboucle et son programme ne calculent donc pas exactement les mêmes signaux. Deux réponses, complémentaires :
  - l'écart est documenté, et le critère 2 le prend en compte ;
  - le mode **« jouer compilé »** fait jouer la scène par son programme compressé (un seul nœud faustwasm, recompilé à chaque changement de structure ; un réglage ne demande pas de recompilation). La scène sonne alors comme son programme, et prend moins de calcul.
- **Le choix du câble retardé.** Dans un cycle, Faust retarde là où est `~` ; la scène retarde les câbles qu'`analyze()` choisit. Pour que l'aller-retour garde le même retard au même endroit, la scène retient les câbles retardés que la décompression lui donne (champ `feedback` du document). `analyze()` les respecte s'ils coupent tous les cycles, et en ajoute sinon.
- **L'ordre des sommes.** Une somme de flottants dépend de l'ordre : le critère 2 admet une erreur relative de 10⁻⁶.
- **Les entrées réservées** des modules synchronisés valent 0 dans le programme, qui n'a pas de ligne de temps commune. Le programme décompressé les rend à la scène.
- **Les canaux physiques.** L'export stéréo forcé ajoute un câblage d'adaptation (`route`), relu comme des câbles. L'aller-retour garde alors 2 entrées et 2 sorties.

# Critères \label{sec:criteres}

1. **Scène → programme → scène (niveau A).** La scène décompressée est égale à la scène de départ, en comparant leurs formes canoniques :
   - les modules triés par identifiant, avec leur nom, l'empreinte de leur code, leur position, leurs paramètres, leurs accéléromètres, leurs modulations et leur vue ;
   - les câbles triés, avec leurs extrémités et le fait qu'ils sont retardés ;
   - les positions des entrées et sorties physiques.

   Test par propriété : des scènes engendrées au hasard (modules à plusieurs entrées et sorties, sommes, cycles, modulations, modules muets), et pour chacune `decompress(compress(s)) = s`.
2. **Programme → scène → programme.** Pour un corpus (les exemples de faustcode, les démos, les modules de la bibliothèque, des programmes avec `~`), le programme recompressé et le programme de départ, rendus hors ligne (libfaust de faustwasm, dans Node) sur 2 secondes d'un bruit fixe aux entrées, donnent les mêmes sorties, à 10⁻⁶ près en relatif. Le rendu de faustcode (`offline-render.js`) sert de référence.
3. **Câblage seul (niveau C sur l'export).** Pour les scènes du critère 1, la décompression du programme **sans son manifeste** donne les mêmes modules (par empreinte), les mêmes câbles et les mêmes câbles retardés. Seules les positions et les réglages diffèrent.
4. **Niveau B.** Un programme compressé, dont on modifie un module dans faustcode, se décompresse avec la nouvelle version du module, à la même place et avec ses réglages. Un module ajouté dans le texte apparaît, placé.

# Surfaces \label{sec:surfaces}

- **Dans faustmodular** :
  - Fichier ▸ *Compresser en programme Faust* ouvre le programme dans faustcode, comme fichier `<Scène>.dsp`, par le lien qui existe entre les deux (`faustcode-link-import`), ou le télécharge ;
  - Fichier ▸ *Ouvrir un programme Faust comme scène…* lit un `.dsp` ;
  - le transport propose *Jouer compilé*.
- **Dans faustcode** :
  - un bouton *Ouvrir comme scène* envoie le fichier à faustmodular, qui le décompresse en une nouvelle scène (un message `faustcode-link-scene { name, code }`) ;
  - un fichier issu d'une compression montre qu'il porte une scène (son manifeste).
- **Dans les magasins** : une scène publiée peut l'être aussi sous sa forme compressée (`scenes/<Nom>/<Nom>.dsp` à côté du `.jfaust`) : lisible et compilable par n'importe quel outil Faust, et décompressable en la même scène.

Le compresseur et le décompresseur sont du code pur (`src/convert/`), sans DOM, testés seuls. Ils rejoignent la bibliothèque commune à faustmodular et faustcode (`spec_files_store.md` de faustcode, « Le code commun »).

# Décisions et points ouverts \label{sec:decisions}

Décisions proposées, à valider :

1. Le programme canonique est l'export actuel, avec tous les modules gardés, des définitions nommées par l'identifiant du module, et un manifeste en commentaire.
2. Le manifeste est du JSON dans un commentaire `/* faustmodular-scene … */`, avec l'empreinte du texte qui le précède.
3. Le décompresseur lit le câblage de n'importe quelle expression par l'interprétation compositionnelle du tableau (nœuds, sommes, unification) ; le manifeste annote, il ne remplace pas la lecture.
4. Les valeurs des paramètres vont au manifeste. Le code des modules n'est jamais réécrit, ce qui garde leurs empreintes.
5. La scène retient les câbles retardés que lui donne une décompression.
6. Le critère 2 est sémantique (rendu, 10⁻⁶) ; le critère 1 est structurel et exact.

Points ouverts :

- **Une forme plus lisible** que le bus et les `route` quand le graphe est série-parallèle (`A : B`, `(A, B) :> C`). C'est un embellissement du compresseur : le décompresseur lit déjà les deux formes.
- **La granularité par défaut** des programmes écrits à la main, et la façon de la régler (un curseur dans la boîte d'ouverture ?).
- **Les définitions à paramètres** (`voice(3)`) : les laisser en feuilles, ou les déplier par substitution.
- **Garder les commentaires** du programme de départ dans le code des modules.
- **Le manifeste en `declare`** encodé (base64) plutôt qu'en commentaire, pour qu'il survive dans le JSON du programme compilé.

# Phases \label{sec:phases}

Chaque phase est utile seule.

1. **Compresser.** Le programme canonique et son manifeste ; Fichier ▸ *Compresser en programme Faust* vers faustcode ou en téléchargement. Critère 1 testable dès qu'existe la phase 2.
2. **Décompresser ce qu'on a compressé.** Le lecteur de câblage, les niveaux A, B et C sur la sortie du compresseur, la reconnaissance des modulations et des entrées réservées ; *Ouvrir un programme Faust comme scène…*. Critères 1, 3 et 4.
3. **Décompresser les programmes écrits à la main.** Les feuilles, la granularité, la fermeture des définitions, la disposition en couches. Critère 2 sur le corpus.
4. **Jouer compilé.** La scène jouée par son programme ; les câbles retardés retenus par la scène.
5. **faustcode et les magasins.** *Ouvrir comme scène* dans faustcode ; la forme compressée publiée à côté de la scène.
